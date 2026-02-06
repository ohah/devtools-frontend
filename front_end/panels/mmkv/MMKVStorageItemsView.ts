// Copyright 2021 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
/* eslint-disable @devtools/no-imperative-dom-api */
/* eslint-disable @devtools/no-lit-render-outside-of-view */

/*
 * Copyright (C) 2008 Nokia Inc.  All rights reserved.
 * Copyright (C) 2013 Samsung Electronics. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import * as Common from '../../core/common/common.js';
import * as i18n from '../../core/i18n/i18n.js';
import * as Geometry from '../../models/geometry/geometry.js';
import * as UI from '../../ui/legacy/legacy.js';
import {Directives as LitDirectives, html, nothing, render} from '../../ui/lit/lit.js';
import * as VisualLogging from '../../ui/visual_logging/visual_logging.js';
import * as ApplicationComponents from '../application/components/components.js';
import {StorageItemsToolbar} from '../application/StorageItemsToolbar.js';

import mmkvPanelStyles from './mmkv.css.js';
import {MMKVStorage} from './MMKVStorageModel.js';

const {ARIAUtils} = UI;
const {VBox, widgetConfig} = UI.Widget;
const {Size} = Geometry;
const {repeat} = LitDirectives;

/** Narrow literal union for MMKV value type / MMKV 값 타입 리터럴 유니온 */
const MMKV_VALUE_TYPES = ['string', 'number', 'boolean', 'buffer'] as const;
type ValueType = (typeof MMKV_VALUE_TYPES)[number];

/** Parse string to ValueType; returns null if not one of the allowed types / 문자열을 ValueType으로 파싱, 허용 타입이 아니면 null */
function parseValueType(s: string): ValueType | null {
  return MMKV_VALUE_TYPES.includes(s as ValueType) ? (s as ValueType) : null;
}

/**
 * Normalize raw valueType from CDP (string or boolean) to ValueType.
 * Handles valueType sent as boolean true/false (e.g. from JSON) so type always shows correctly.
 * / CDP에서 오는 valueType(문자열 또는 boolean)을 ValueType으로 정규화. JSON 등으로 boolean으로 오면 올바르게 'boolean'으로 표시
 */
function normalizeValueType(raw: unknown): ValueType {
  if (raw === true || raw === false) {
    return 'boolean';
  }
  if (typeof raw === 'string') {
    const t = parseValueType(raw);
    if (t) {
      return t;
    }
  }
  return 'string';
}

const UIStrings = {
  /**
   * @description Name for the MMKV Storage Items table.
   */
  mmkvStorageItems: 'MMKV Storage Items',
  /**
   * @description Text when MMKV Storage Items table was cleared.
   */
  mmkvStorageItemsCleared: 'MMKV Storage Items cleared',
  /**
   * @description Text when a MMKV storage item was deleted.
   */
  mmkvStorageItemDeleted: 'The storage item was deleted.',
  /**
   * @description Text for number of entries shown in table.
   * @example {5} PH1
   */
  numberEntries: 'Number of entries shown in table: {PH1}',
  /**
   * @description Column header for key.
   */
  key: 'Key',
  /**
   * @description Column header for type.
   */
  type: 'Type',
  /**
   * @description Column header for value.
   */
  value: 'Value',
  /**
   * @description Warning when value is invalid for number type.
   */
  invalidNumberValue: 'Invalid number: value must be a valid number.',
  /**
   * @description Warning when value is invalid for buffer type.
   */
  invalidBufferValue: 'Invalid buffer: value must be a JSON array of numbers (e.g. [0,1,2]).',
  /**
   * @description Warning when value is invalid for boolean type.
   */
  invalidBooleanValue: 'Invalid boolean: value must be "true" or "false".',
  /**
   * @description Error when key is empty on update.
   */
  keyRequired: 'Key is required.',
  /**
   * @description Update button label.
   */
  update: 'Update',
  /**
   * @description Delete button label (per row).
   */
  delete: 'Delete',
  /**
   * @description Add item button label.
   */
  addItem: 'Add item',
} as const;
const str_ = i18n.i18n.registerUIStrings('panels/mmkv/MMKVStorageItemsView.ts', UIStrings);
const i18nString = i18n.i18n.getLocalizedString.bind(undefined, str_);

export interface MMKVItem {
  key: string;
  value: string;
  valueType: ValueType;
}

/**
 * Validate value string for given MMKV type / MMKV 타입에 맞는 값 문자열 검증
 */
export function validateValueForType(value: string, valueType: ValueType): {valid: boolean, message?: string} {
  if (valueType === 'string') {
    return {valid: true};
  }
  if (valueType === 'number') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return {valid: false, message: i18nString(UIStrings.invalidNumberValue)};
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
      return {valid: false, message: i18nString(UIStrings.invalidNumberValue)};
    }
    return {valid: true};
  }
  if (valueType === 'boolean') {
    if (value !== 'true' && value !== 'false') {
      return {valid: false, message: i18nString(UIStrings.invalidBooleanValue)};
    }
    return {valid: true};
  }
  if (valueType === 'buffer') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return {valid: false, message: i18nString(UIStrings.invalidBufferValue)};
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!Array.isArray(parsed)) {
        return {valid: false, message: i18nString(UIStrings.invalidBufferValue)};
      }
      for (let i = 0; i < parsed.length; i++) {
        const v = parsed[i];
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 255) {
          return {valid: false, message: i18nString(UIStrings.invalidBufferValue)};
        }
      }
      return {valid: true};
    } catch {
      return {valid: false, message: i18nString(UIStrings.invalidBufferValue)};
    }
  }
  return {valid: true};
}

/** Draft for one row (key may differ from original when renaming) / 한 행의 드래프트 */
interface RowDraft {
  key: string;
  value: string;
  valueType: ValueType;
}

export class MMKVStorageItemsView extends UI.Widget.VBox {
  #mmkvStorage: MMKVStorage;
  #eventListeners: Common.EventTarget.EventDescriptor[] = [];
  #items: MMKVItem[] = [];
  #selectedKey: string|null = null;
  #isSortOrderAscending = true;
  #toolbar: StorageItemsToolbar|undefined;
  readonly #metadataView: ApplicationComponents.StorageMetadataView.StorageMetadataView;
  #drafts = new Map<string, RowDraft>();
  #validationErrors = new Map<string, string>();
  #newRowIds: string[] = [];

  constructor(mmkvStorage: MMKVStorage) {
    super();
    this.#mmkvStorage = mmkvStorage;
    this.#metadataView = new ApplicationComponents.StorageMetadataView.StorageMetadataView();
    this.#metadataView.getTitle = () => mmkvStorage.instanceId;
    this.element.classList.add('mmkv-view', 'table');
    this.registerRequiredCSS(mmkvPanelStyles);
    this.setStorage(mmkvStorage);
    this.performUpdate();
  }

  get storage(): MMKVStorage {
    return this.#mmkvStorage;
  }

  setStorage(mmkvStorage: MMKVStorage): void {
    Common.EventTarget.removeEventListeners(this.#eventListeners);
    this.#mmkvStorage = mmkvStorage;
    this.#metadataView.getTitle = () => mmkvStorage.instanceId;
    this.element.setAttribute('jslog', `${VisualLogging.pane().context('mmkv-storage-data')}`);
    this.#eventListeners = [
      mmkvStorage.addEventListener(MMKVStorage.Events.MMKV_ITEMS_CLEARED, this.#itemsCleared, this),
      mmkvStorage.addEventListener(MMKVStorage.Events.MMKV_ITEM_REMOVED, this.#itemRemoved, this),
      mmkvStorage.addEventListener(MMKVStorage.Events.MMKV_ITEM_ADDED, this.#itemAdded, this),
      mmkvStorage.addEventListener(MMKVStorage.Events.MMKV_ITEM_UPDATED, this.#itemUpdated, this),
    ];
    this.refreshItems();
  }

  override wasShown(): void {
    super.wasShown();
    this.refreshItems();
  }

  refreshItems(): void {
    void this.#refreshItems();
  }

  #rowToItem(row: unknown): MMKVItem | null {
    const toStr = (x: unknown): string =>
      (x !== null && x !== undefined) ? String(x) : '';

    if (row !== null && typeof row === 'object' && !Array.isArray(row)) {
      const o = row as Record<string, unknown>;
      if ('0' in o || '1' in o || '2' in o) {
        return this.#rowToItem([o[0], o[1], o[2]]);
      }
      const key = toStr(o.key);
      const value = toStr(o.value);
      const rawType = o.valueType;
      if (key === '' && value === '' && rawType === undefined) {
        return null;
      }
      const valueType = normalizeValueType(rawType);
      return {key, value, valueType};
    }
    // Protocol Item = [key, value, valueType]. Read by index so we always get correct type from result.
    // / 프로토콜 Item = [key, value, valueType]. result.entries에서 인덱스로 읽어 타입 보장
    const arr = Array.isArray(row) ? row : [];
    const key = String(arr[0] ?? '');
    const value = toStr(arr[1]);
    const rawType = arr[2];
    const valueType = normalizeValueType(rawType);
    return {key, value, valueType};
  }

  async #refreshItems(): Promise<void> {
    const raw = await this.#mmkvStorage.getItems();
    const entries = Array.isArray(raw) ? raw : [];
    const filterRegex = this.#toolbar?.filterRegex ?? null;
    const items: MMKVItem[] = entries
        .map((row): MMKVItem | null => this.#rowToItem(row))
        .filter((item): item is MMKVItem => item !== null)
        .filter(
            item =>
                filterRegex?.test(`${item.key} ${item.value} ${item.valueType}`) ?? true);
    this.#showItems(items);
  }

  #showItems(items: MMKVItem[]): void {
    const sortDirection = this.#isSortOrderAscending ? 1 : -1;
    this.#items = [...items].sort(
        (a, b) => sortDirection * (a.key > b.key ? 1 : a.key < b.key ? -1 : 0));
    for (const item of this.#items) {
      this.#drafts.delete(item.key);
    }
    const selected = this.#items.find(item => item.key === this.#selectedKey);
    if (!selected) {
      this.#selectedKey = null;
    }
    this.performUpdate();
    this.#toolbar?.setCanDeleteSelected(Boolean(this.#selectedKey));
    ARIAUtils.LiveAnnouncer.alert(i18nString(UIStrings.numberEntries, {PH1: this.#items.length}));
  }

  #itemsCleared(): void {
    if (!this.isShowing()) {
      return;
    }
    this.#items = [];
    this.#selectedKey = null;
    this.#drafts.clear();
    this.#validationErrors.clear();
    this.#newRowIds = [];
    this.performUpdate();
    this.#toolbar?.setCanDeleteAll(false);
    this.#toolbar?.setCanDeleteSelected(false);
    UI.ARIAUtils.LiveAnnouncer.alert(i18nString(UIStrings.mmkvStorageItemsCleared));
  }

  #itemRemoved(event: Common.EventTarget.EventTargetEvent<MMKVStorage.MmkvItemRemovedEvent>): void {
    if (!this.isShowing()) {
      return;
    }
    const key = event.data.key;
    this.#drafts.delete(key);
    this.#validationErrors.delete(key);
    const index = this.#items.findIndex(item => item.key === key);
    if (index !== -1) {
      this.#items.splice(index, 1);
      if (this.#selectedKey === key) {
        this.#selectedKey = this.#items.length ? this.#items[0].key : null;
      }
      this.performUpdate();
    }
    this.#toolbar?.setCanDeleteAll(this.#items.length > 0);
    this.#toolbar?.setCanDeleteSelected(Boolean(this.#selectedKey));
    UI.ARIAUtils.LiveAnnouncer.alert(i18nString(UIStrings.mmkvStorageItemDeleted));
  }

  #itemAdded(event: Common.EventTarget.EventTargetEvent<MMKVStorage.MmkvItemAddedEvent>): void {
    if (!this.isShowing()) {
      return;
    }
    const {key, value, valueType: rawType} = event.data;
    const valueStr = String(value ?? '');
    const valueType = normalizeValueType(rawType);
    if (this.#items.some(item => item.key === key)) {
      return;
    }
    this.#items.push({key, value: valueStr, valueType});
    this.#items.sort((a, b) => (this.#isSortOrderAscending ? 1 : -1) * (a.key > b.key ? 1 : -1));
    this.performUpdate();
  }

  #itemUpdated(event: Common.EventTarget.EventTargetEvent<MMKVStorage.MmkvItemUpdatedEvent>): void {
    if (!this.isShowing()) {
      return;
    }
    const {key, value, valueType: rawType} = event.data;
    const item = this.#items.find(i => i.key === key);
    if (!item) {
      return;
    }
    item.value = String(value ?? '');
    item.valueType = normalizeValueType(rawType);
    this.performUpdate();
  }

  deleteAllItems(): void {
    this.#mmkvStorage.clear();
    this.#itemsCleared();
  }

  #deleteCallback(key: string): void {
    this.#mmkvStorage.removeItem(key);
  }

  #getDisplayDraft(rowId: string, fallback: MMKVItem): RowDraft {
    return this.#drafts.get(rowId) ?? { ...fallback };
  }

  #setDraft(rowId: string, patch: Partial<RowDraft>): void {
    const fallback =
        rowId.startsWith('new-')
            ? { key: '', value: '', valueType: 'string' as ValueType }
            : this.#items.find(i => i.key === rowId) ?? { key: '', value: '', valueType: 'string' as ValueType };
    const current = this.#getDisplayDraft(rowId, fallback);
    this.#drafts.set(rowId, { ...current, ...patch });
    this.#validationErrors.delete(rowId);
    this.performUpdate();
  }

  #handleUpdateClick(rowId: string): void {
    const isNew = rowId.startsWith('new-');
    const existingItem = this.#items.find(i => i.key === rowId);
    const fallback: MMKVItem = isNew
      ? { key: '', value: '', valueType: 'string' }
      : (existingItem ?? { key: '', value: '', valueType: 'string' });
    const draft = this.#getDisplayDraft(rowId, fallback);

    if (!draft.key.trim()) {
      this.#validationErrors.set(rowId, i18nString(UIStrings.keyRequired));
      this.performUpdate();
      return;
    }
    const validation = validateValueForType(draft.value, draft.valueType);
    if (!validation.valid) {
      this.#validationErrors.set(rowId, validation.message ?? '');
      this.performUpdate();
      return;
    }

    this.#validationErrors.delete(rowId);
    if (isNew) {
      this.#mmkvStorage.setItem(draft.key.trim(), draft.value, draft.valueType);
      this.#drafts.delete(rowId);
      this.#newRowIds = this.#newRowIds.filter(id => 'new-' + id !== rowId);
      void this.#refreshItems();
    } else {
      const originalKey = rowId;
      if (draft.key.trim() !== originalKey) {
        this.#mmkvStorage.removeItem(originalKey);
      }
      this.#mmkvStorage.setItem(draft.key.trim(), draft.value, draft.valueType);
      this.#drafts.delete(rowId);
      void this.#refreshItems();
    }
    this.performUpdate();
  }

  #handleAddItem(): void {
    const id = String(Date.now());
    this.#newRowIds = [...this.#newRowIds, id];
    this.#drafts.set('new-' + id, { key: '', value: '', valueType: 'string' });
    this.performUpdate();
  }

  deleteSelectedItem(): void {
    if (!this.#selectedKey) {
      return;
    }
    this.#deleteCallback(this.#selectedKey);
  }

  override performUpdate(): void {
    const that = this;
    const setToolbar = (toolbar: StorageItemsToolbar): void => {
      that.#toolbar?.removeEventListener(StorageItemsToolbar.Events.DELETE_SELECTED, that.deleteSelectedItem, that);
      that.#toolbar?.removeEventListener(StorageItemsToolbar.Events.DELETE_ALL, that.deleteAllItems, that);
      that.#toolbar?.removeEventListener(StorageItemsToolbar.Events.REFRESH, that.refreshItems, that);
      that.#toolbar = toolbar;
      that.#toolbar.addEventListener(StorageItemsToolbar.Events.DELETE_SELECTED, that.deleteSelectedItem, that);
      that.#toolbar.addEventListener(StorageItemsToolbar.Events.DELETE_ALL, that.deleteAllItems, that);
      that.#toolbar.addEventListener(StorageItemsToolbar.Events.REFRESH, that.refreshItems, that);
      that.#toolbar.setCanDeleteAll(that.#items.length > 0);
      that.#toolbar.setCanDeleteSelected(Boolean(that.#selectedKey));
    };

    const sortDirection = this.#isSortOrderAscending ? 1 : -1;
    const sortedItems = [...this.#items].sort(
        (a, b) => sortDirection * (a.key > b.key ? 1 : a.key < b.key ? -1 : 0));
    const rows: Array<{ rowId: string, item: MMKVItem }> = [
      ...sortedItems.map(item => ({ rowId: item.key, item })),
      ...this.#newRowIds.map(id => ({
        rowId: 'new-' + id,
        item: this.#getDisplayDraft('new-' + id, { key: '', value: '', valueType: 'string' }) as MMKVItem,
      })),
    ];

    render(
        html`
        <devtools-widget
          .widgetConfig=${widgetConfig(StorageItemsToolbar, {metadataView: this.#metadataView})}
          class=flex-none
          ${UI.Widget.widgetRef(StorageItemsToolbar, setToolbar)}
        ></devtools-widget>
        <devtools-widget
          .widgetConfig=${widgetConfig(VBox, {minimumSize: new Size(0, 50)})}
        >
            <div class="mmkv-custom-table-container" data-mmkv-view="custom" aria-label=${i18nString(UIStrings.mmkvStorageItems)}>
              <div class="mmkv-toolbar-row">
                <button class="mmkv-add-button" @click=${() => this.#handleAddItem()} jslog=${VisualLogging.action('mmkv-storage.add-item').track({click: true})}>
                  ${i18nString(UIStrings.addItem)}
                </button>
              </div>
              <table class="mmkv-custom-table" data-mmkv-table="true">
                <thead>
                  <tr>
                    <th class="mmkv-th-key">${i18nString(UIStrings.key)}</th>
                    <th class="mmkv-th-type">${i18nString(UIStrings.type)}</th>
                    <th class="mmkv-th-value">${i18nString(UIStrings.value)}</th>
                    <th class="mmkv-th-actions">${i18nString(UIStrings.update)}</th>
                  </tr>
                </thead>
                <tbody>
                  ${repeat(rows, row => row.rowId, row => {
                    const display = this.#getDisplayDraft(row.rowId, row.item);
                    const err = this.#validationErrors.get(row.rowId);
                    const isNew = row.rowId.startsWith('new-');
                    return html`
                    <tr
                      class="mmkv-row ${!isNew && this.#selectedKey === row.rowId ? 'mmkv-row-selected' : ''}"
                          @click=${(e: Event) => {
                            if (isNew) {
                              return;
                            }
                            e.preventDefault();
                        this.#selectedKey = row.item.key;
                        this.#toolbar?.setCanDeleteSelected(true);
                      }}
                    >
                      <td class="mmkv-td-key">
                        <input
                          class="mmkv-input"
                          .value=${display.key}
                          @input=${(e: Event) => this.#setDraft(row.rowId, { key: (e.target as HTMLInputElement).value })}
                          @click=${(e: Event) => e.stopPropagation()}
                        />
                      </td>
                      <td class="mmkv-td-type">
                        <select
                          class="mmkv-type-select"
                          .value=${display.valueType}
                          @change=${(e: Event) => {
                            const v = (e.target as HTMLSelectElement).value;
                            const t = parseValueType(v);
                            if (t) {
                              this.#setDraft(row.rowId, { valueType: t });
                            }
                          }}
                          @click=${(e: Event) => e.stopPropagation()}
                        >
                          ${MMKV_VALUE_TYPES.map(
                            t =>
                              html`<option value=${t} .selected=${t === display.valueType}>${t}</option>`,
                          )}
                        </select>
                      </td>
                      <td class="mmkv-td-value">
                        <input
                          class="mmkv-input mmkv-input-value"
                          .value=${display.value}
                          @input=${(e: Event) => this.#setDraft(row.rowId, { value: (e.target as HTMLInputElement).value })}
                          @click=${(e: Event) => e.stopPropagation()}
                        />
                      </td>
                      <td class="mmkv-td-actions">
                        <button
                          class="mmkv-update-button"
                          @click=${(e: Event) => { e.stopPropagation(); this.#handleUpdateClick(row.rowId); }}
                          jslog=${VisualLogging.action('mmkv-storage.update').track({click: true})}
                        >${i18nString(UIStrings.update)}</button>
                        ${!isNew
                          ? html`<button
                              class="mmkv-delete-button"
                              @click=${(e: Event) => {
                                e.stopPropagation();
                                const key = row.item.key;
                                this.#deleteCallback(key);
                                const idx = this.#items.findIndex(i => i.key === key);
                                if (idx !== -1) {
                                  this.#items.splice(idx, 1);
                                  if (this.#selectedKey === key) {
                                    this.#selectedKey = this.#items.length ? this.#items[0].key : null;
                                  }
                                  this.#drafts.delete(key);
                                  this.#validationErrors.delete(key);
                                }
                                this.#toolbar?.setCanDeleteAll(this.#items.length > 0);
                                this.#toolbar?.setCanDeleteSelected(Boolean(this.#selectedKey));
                                this.performUpdate();
                              }}
                              jslog=${VisualLogging.action('mmkv-storage.delete').track({click: true})}
                            >${i18nString(UIStrings.delete)}</button>`
                          : nothing}
                      </td>
                    </tr>
                    ${err ? html`<tr class="mmkv-error-row"><td colspan="4" class="mmkv-validation-error">${err}</td></tr>` : nothing}
                    `;
                  })}
                </tbody>
              </table>
            </div>
        </devtools-widget>`,
        this.contentElement);
    this.#toolbar?.setCanDeleteAll(this.#items.length > 0);
    this.#toolbar?.setCanDeleteSelected(Boolean(this.#selectedKey));
  }

  protected get toolbar(): StorageItemsToolbar|undefined {
    return this.#toolbar;
  }
}
