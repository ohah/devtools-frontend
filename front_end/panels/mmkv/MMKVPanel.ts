// Copyright 2025 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
/* eslint-disable @devtools/no-imperative-dom-api */

import type * as Common from '../../core/common/common.js';
import type * as Platform from '../../core/platform/platform.js';
import * as SDK from '../../core/sdk/sdk.js';
import {createIcon} from '../../ui/kit/kit.js';
import * as UI from '../../ui/legacy/legacy.js';
import * as VisualLogging from '../../ui/visual_logging/visual_logging.js';

import {MMKVStorageItemsView} from './MMKVStorageItemsView.js';
import {MMKVStorageModel, Events as MMKVStorageModelEvents, type MMKVStorage} from './MMKVStorageModel.js';

let mmkvPanelInstance: MMKVPanel|null = null;

/** Panel interface for MMKV sidebar / MMKV 사이드바용 패널 인터페이스 */
export interface MMKVPanelContract {
  showView(view: UI.Widget.Widget|null): void;
  showMMKVStorage(mmkvStorage: MMKVStorage): void;
}

export class MMKVPanel extends UI.Panel.PanelWithSidebar implements MMKVPanelContract {
  visibleView: UI.Widget.Widget|null;
  private pendingViewPromise: Promise<UI.Widget.Widget>|null;
  storageViews: HTMLElement;
  private readonly storageViewToolbar: UI.Toolbar.Toolbar;
  private mmkvStorageView: MMKVStorageItemsView|null;
  private readonly sidebar: MMKVPanelSidebar;

  private constructor() {
    super('mmkv');

    this.visibleView = null;
    this.pendingViewPromise = null;

    const mainContainer = new UI.Widget.VBox();
    mainContainer.setMinimumSize(100, 0);
    this.storageViews = mainContainer.element.createChild('div', 'vbox flex-auto');
    this.storageViewToolbar = mainContainer.element.createChild('devtools-toolbar', 'resources-toolbar');
    this.splitWidget().setMainWidget(mainContainer);

    this.mmkvStorageView = null;

    this.sidebar = new MMKVPanelSidebar(this);
    this.sidebar.show(this.panelSidebarElement());
  }

  static instance(opts: {forceNew: boolean|null} = {forceNew: null}): MMKVPanel {
    const {forceNew} = opts;
    if (!mmkvPanelInstance || forceNew) {
      mmkvPanelInstance = new MMKVPanel();
    }
    return mmkvPanelInstance;
  }

  override focus(): void {
    this.sidebar.focus();
  }

  showView(view: UI.Widget.Widget|null): void {
    this.pendingViewPromise = null;
    if (this.visibleView === view) {
      return;
    }
    if (this.visibleView) {
      this.visibleView.detach();
    }
    if (view) {
      view.show(this.storageViews);
    }
    this.visibleView = view;
    this.storageViewToolbar.removeToolbarItems();
    this.storageViewToolbar.classList.toggle('hidden', true);
    if (view instanceof UI.View.SimpleView) {
      void view.toolbarItems().then(items => {
        items.map(item => this.storageViewToolbar.appendToolbarItem(item));
        this.storageViewToolbar.classList.toggle('hidden', !items.length);
      });
    }
  }

  showMMKVStorage(mmkvStorage: MMKVStorage): void {
    if (!mmkvStorage) {
      return;
    }
    if (!this.mmkvStorageView) {
      this.mmkvStorageView = new MMKVStorageItemsView(mmkvStorage);
    } else {
      this.mmkvStorageView.setStorage(mmkvStorage);
    }
    this.showView(this.mmkvStorageView);
  }

  showCategoryView(
      _categoryName: string, categoryHeadline: string, categoryDescription: string,
      _categoryLink: Platform.DevToolsPath.UrlString|null): void {
    const categoryView = new UI.Widget.VBox();
    categoryView.element.classList.add('storage-category-view');
    const headline = categoryView.element.createChild('div', 'storage-category-headline');
    headline.textContent = categoryHeadline;
    const description = categoryView.element.createChild('div', 'storage-category-description');
    description.textContent = categoryDescription;
    this.showView(categoryView);
  }
}

/** MMKV panel sidebar: flat list of MMKV instances / MMKV 패널 사이드바: 인스턴스 목록 */
class MMKVPanelSidebar extends UI.Widget.VBox {
  private readonly panel: MMKVPanel;
  private readonly sidebarTree: UI.TreeOutline.TreeOutlineInShadow;
  private mmkvStorageTreeElements: Map<MMKVStorage, MMKVStorageTreeElement>;

  constructor(panel: MMKVPanel) {
    super();
    this.panel = panel;
    this.element.classList.add('storage-panel-sidebar');
    this.sidebarTree = new UI.TreeOutline.TreeOutlineInShadow();
    this.sidebarTree.element.classList.add('storage-panel-sidebar-tree');
    this.sidebarTree.setFocusable(true);
    this.element.appendChild(this.sidebarTree.element);

    this.mmkvStorageTreeElements = new Map();

    SDK.TargetManager.TargetManager.instance().observeModels(
        MMKVStorageModel,
        {
          modelAdded: (model: MMKVStorageModel) => this.mmkvStorageModelAdded(model),
          modelRemoved: (model: MMKVStorageModel) => this.mmkvStorageModelRemoved(model),
        },
        {scoped: true});
  }

  override focus(): void {
    this.sidebarTree.focus();
  }

  private mmkvStorageModelAdded(model: MMKVStorageModel): void {
    model.addEventListener(MMKVStorageModelEvents.MMKV_STORAGE_ADDED, this.mmkvStorageAdded, this);
    model.addEventListener(MMKVStorageModelEvents.MMKV_STORAGE_REMOVED, this.mmkvStorageRemoved, this);
    model.enable();
    for (const storage of model.storages()) {
      this.addMMKVStorage(storage);
    }
  }

  private mmkvStorageModelRemoved(model: MMKVStorageModel): void {
    model.removeEventListener(MMKVStorageModelEvents.MMKV_STORAGE_ADDED, this.mmkvStorageAdded, this);
    model.removeEventListener(MMKVStorageModelEvents.MMKV_STORAGE_REMOVED, this.mmkvStorageRemoved, this);
    for (const storage of model.storages()) {
      this.removeMMKVStorage(storage);
    }
  }

  private mmkvStorageAdded = (event: Common.EventTarget.EventTargetEvent<MMKVStorage>): void => {
    this.addMMKVStorage(event.data);
  };

  private addMMKVStorage(mmkvStorage: MMKVStorage): void {
    if (this.mmkvStorageTreeElements.has(mmkvStorage)) {
      return;
    }
    const mmkvStorageTreeElement = new MMKVStorageTreeElement(this.panel, mmkvStorage);
    this.mmkvStorageTreeElements.set(mmkvStorage, mmkvStorageTreeElement);

    function comparator(a: UI.TreeOutline.TreeElement, b: UI.TreeOutline.TreeElement): number {
      return a.titleAsText().toLocaleLowerCase().localeCompare(b.titleAsText().toLocaleLowerCase());
    }
    this.sidebarTree.appendChild(mmkvStorageTreeElement, comparator);
  }

  private mmkvStorageRemoved = (event: Common.EventTarget.EventTargetEvent<MMKVStorage>): void => {
    this.removeMMKVStorage(event.data);
  };

  private removeMMKVStorage(mmkvStorage: MMKVStorage): void {
    const treeElement = this.mmkvStorageTreeElements.get(mmkvStorage);
    if (!treeElement) {
      return;
    }
    const wasSelected = treeElement.selected;
    this.sidebarTree.removeChild(treeElement);
    this.mmkvStorageTreeElements.delete(mmkvStorage);
    if (wasSelected && this.sidebarTree.rootElement().childCount() > 0) {
      const firstChild = this.sidebarTree.rootElement().childAt(0);
      if (firstChild) {
        firstChild.select();
      }
    }
  }
}

/** MMKV storage tree element (sidebar row) / MMKV 스토리지 트리 엘리먼트 */
class MMKVStorageTreeElement extends UI.TreeOutline.TreeElement {
  private readonly panel: MMKVPanelContract;
  private readonly mmkvStorage: MMKVStorage;

  constructor(panel: MMKVPanelContract, mmkvStorage: MMKVStorage) {
    super(mmkvStorage.instanceId, false, 'mmkv-storage-for-instance');
    this.panel = panel;
    this.mmkvStorage = mmkvStorage;
    const icon = createIcon('table');
    this.setLeadingIcons([icon]);
    this.listItemElement.setAttribute('jslog', `${VisualLogging.treeItem('mmkv-storage-instance')}`);
  }

  get itemURL(): Platform.DevToolsPath.UrlString {
    return 'mmkv-storage://' + this.mmkvStorage.instanceId as Platform.DevToolsPath.UrlString;
  }

  override onselect(_selectedByUser?: boolean): boolean {
    super.onselect(_selectedByUser);
    this.panel.showMMKVStorage(this.mmkvStorage);
    return false;
  }

  override onattach(): void {
    super.onattach();
    this.listItemElement.addEventListener('contextmenu', this.handleContextMenuEvent.bind(this), true);
  }

  private handleContextMenuEvent(event: MouseEvent): void {
    const contextMenu = new UI.ContextMenu.ContextMenu(event);
    contextMenu.defaultSection().appendItem(
        'Clear', () => this.mmkvStorage.clear(), {jslogContext: 'clear'});
    void contextMenu.show();
  }
}
