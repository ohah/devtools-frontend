// Copyright 2021 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/*
 * Copyright (C) 2008 Nokia Inc.  All rights reserved.
 * Copyright (C) 2013 Samsung Electronics. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 * 3.  Neither the name of Apple Computer, Inc. ("Apple") nor the names of
 *     its contributors may be used to endorse or promote products derived
 *     from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import * as Common from '../../core/common/common.js';
import * as SDK from '../../core/sdk/sdk.js';
import type * as ProtocolProxyApi from '../../generated/protocol-proxy-api.js';
import type * as Protocol from '../../generated/protocol.js';

export class MMKVStorage extends Common.ObjectWrapper.ObjectWrapper<MMKVStorage.EventTypes> {
  private readonly model: MMKVStorageModel;
  readonly #instanceId: string;

  constructor(model: MMKVStorageModel, instanceId: string) {
    super();
    this.model = model;
    this.#instanceId = instanceId;
  }

  get instanceId(): string {
    return this.#instanceId;
  }

  getItems(): Promise<Protocol.MMKVStorage.Item[]|null> {
    return this.model.agent.invoke_getMMKVItems({instanceId: this.instanceId}).then(({entries}) => entries);
  }

  setItem(key: string, value: string): void {
    void this.model.agent.invoke_setMMKVItem({instanceId: this.instanceId, key, value});
  }

  removeItem(key: string): void {
    void this.model.agent.invoke_removeMMKVItem({instanceId: this.instanceId, key});
  }

  clear(): void {
    void this.model.agent.invoke_clear({instanceId: this.instanceId});
  }
}

export namespace MMKVStorage {
  export const enum Events {
    MMKV_ITEMS_CLEARED = 'MMKVItemsCleared',
    MMKV_ITEM_REMOVED = 'MMKVItemRemoved',
    MMKV_ITEM_ADDED = 'MMKVItemAdded',
    MMKV_ITEM_UPDATED = 'MMKVItemUpdated',
  }

  export interface MMKVItemRemovedEvent {
    key: string;
  }

  export interface MMKVItemAddedEvent {
    key: string;
    value: string;
  }

  export interface MMKVItemUpdatedEvent {
    key: string;
    oldValue: string;
    value: string;
  }

  export interface EventTypes {
    [Events.MMKV_ITEMS_CLEARED]: void;
    [Events.MMKV_ITEM_REMOVED]: MMKVItemRemovedEvent;
    [Events.MMKV_ITEM_ADDED]: MMKVItemAddedEvent;
    [Events.MMKV_ITEM_UPDATED]: MMKVItemUpdatedEvent;
  }
}

export class MMKVStorageModel extends SDK.SDKModel.SDKModel<EventTypes> {
  #storages: Map<string, MMKVStorage>;
  readonly agent: ProtocolProxyApi.MMKVStorageApi;
  private enabled?: boolean;

  constructor(target: SDK.Target.Target) {
    super(target);

    this.#storages = new Map();
    // Note: mmkvStorageAgent() needs to be added to Target class / 참고: mmkvStorageAgent()는 Target 클래스에 추가되어야 합니다
    // For now, use a type assertion / 지금은 타입 단언 사용
    this.agent = (target as any).mmkvStorageAgent() as ProtocolProxyApi.MMKVStorageApi;
  }

  enable(): void {
    if (this.enabled) {
      return;
    }

    // Note: registerMMKVStorageDispatcher needs to be added to Target/InspectorBackend / 참고: registerMMKVStorageDispatcher는 Target/InspectorBackend에 추가되어야 합니다
    // For now, use a type assertion / 지금은 타입 단언 사용
    (this.target() as any).registerMMKVStorageDispatcher(new MMKVStorageDispatcher(this));
    void this.agent.invoke_enable();

    this.enabled = true;
  }

  mmkvItemsCleared({instanceId}: Protocol.MMKVStorage.MMKVItemsClearedEvent): void {
    const mmkvStorage = this.storageForInstanceId(instanceId);
    if (!mmkvStorage) {
      return;
    }

    mmkvStorage.dispatchEventToListeners(MMKVStorage.Events.MMKV_ITEMS_CLEARED);
  }

  mmkvItemRemoved({instanceId, key}: Protocol.MMKVStorage.MMKVItemRemovedEvent): void {
    const mmkvStorage = this.storageForInstanceId(instanceId);
    if (!mmkvStorage) {
      return;
    }

    const eventData = {key};
    mmkvStorage.dispatchEventToListeners(MMKVStorage.Events.MMKV_ITEM_REMOVED, eventData);
  }

  mmkvItemAdded({instanceId, key, newValue}: Protocol.MMKVStorage.MMKVItemAddedEvent): void {
    const mmkvStorage = this.storageForInstanceId(instanceId);
    if (!mmkvStorage) {
      // Create storage if it doesn't exist / 존재하지 않으면 스토리지 생성
      mmkvStorage = this.addStorage(instanceId);
    }

    const eventData = {key, value: newValue};
    mmkvStorage.dispatchEventToListeners(MMKVStorage.Events.MMKV_ITEM_ADDED, eventData);
  }

  mmkvItemUpdated({instanceId, key, oldValue, newValue}: Protocol.MMKVStorage.MMKVItemUpdatedEvent): void {
    const mmkvStorage = this.storageForInstanceId(instanceId);
    if (!mmkvStorage) {
      return;
    }

    const eventData = {key, oldValue, value: newValue};
    mmkvStorage.dispatchEventToListeners(MMKVStorage.Events.MMKV_ITEM_UPDATED, eventData);
  }

  mmkvInstanceCreated({instanceId}: Protocol.MMKVStorage.MMKVInstanceCreatedEvent): void {
    // Create storage for new instance / 새 인스턴스에 대한 스토리지 생성
    this.addStorage(instanceId);
  }

  private addStorage(instanceId: string): MMKVStorage {
    if (this.#storages.has(instanceId)) {
      return this.#storages.get(instanceId)!;
    }

    const storage = new MMKVStorage(this, instanceId);
    this.#storages.set(instanceId, storage);
    this.dispatchEventToListeners(Events.MMKV_STORAGE_ADDED, storage);
    return storage;
  }

  private storageForInstanceId(instanceId: string): MMKVStorage|null {
    return this.#storages.get(instanceId) || null;
  }

  storages(): MMKVStorage[] {
    return Array.from(this.#storages.values());
  }
}

SDK.SDKModel.SDKModel.register(MMKVStorageModel, {capabilities: SDK.Target.Capability.None, autostart: false});

export const enum Events {
  MMKV_STORAGE_ADDED = 'MMKVStorageAdded',
  MMKV_STORAGE_REMOVED = 'MMKVStorageRemoved',
}

export interface EventTypes {
  [Events.MMKV_STORAGE_ADDED]: MMKVStorage;
  [Events.MMKV_STORAGE_REMOVED]: MMKVStorage;
}

export class MMKVStorageDispatcher implements ProtocolProxyApi.MMKVStorageDispatcher {
  private readonly model: MMKVStorageModel;
  constructor(model: MMKVStorageModel) {
    this.model = model;
  }

  mmkvItemsCleared({instanceId}: Protocol.MMKVStorage.MMKVItemsClearedEvent): void {
    this.model.mmkvItemsCleared({instanceId});
  }

  mmkvItemRemoved({instanceId, key}: Protocol.MMKVStorage.MMKVItemRemovedEvent): void {
    this.model.mmkvItemRemoved({instanceId, key});
  }

  mmkvItemAdded({instanceId, key, newValue}: Protocol.MMKVStorage.MMKVItemAddedEvent): void {
    this.model.mmkvItemAdded({instanceId, key, newValue});
  }

  mmkvItemUpdated({instanceId, key, oldValue, newValue}: Protocol.MMKVStorage.MMKVItemUpdatedEvent): void {
    this.model.mmkvItemUpdated({instanceId, key, oldValue, newValue});
  }

  mmkvInstanceCreated({instanceId}: Protocol.MMKVStorage.MMKVInstanceCreatedEvent): void {
    this.model.mmkvInstanceCreated({instanceId});
  }
}
