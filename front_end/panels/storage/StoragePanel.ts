// Copyright 2025 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
/* eslint-disable @devtools/no-imperative-dom-api */

import * as Common from '../../core/common/common.js';
import type * as Platform from '../../core/platform/platform.js';
import * as SDK from '../../core/sdk/sdk.js';
import {createIcon} from '../../ui/kit/kit.js';
import * as UI from '../../ui/legacy/legacy.js';
import * as VisualLogging from '../../ui/visual_logging/visual_logging.js';
import {MMKVStorageItemsView} from '../application/MMKVStorageItemsView.js';
import {MMKVStorageModel, type MMKVStorage, Events as MMKVStorageModelEvents} from '../application/MMKVStorageModel.js';

let storagePanelInstance: StoragePanel;

export class StoragePanel extends UI.Panel.PanelWithSidebar {
  visibleView: UI.Widget.Widget|null;
  private pendingViewPromise: Promise<UI.Widget.Widget>|null;
  storageViews: HTMLElement;
  private readonly storageViewToolbar: UI.Toolbar.Toolbar;
  private mmkvStorageView: MMKVStorageItemsView|null;
  private readonly sidebar: StoragePanelSidebar;

  private constructor() {
    super('storage');

    this.visibleView = null;
    this.pendingViewPromise = null;

    const mainContainer = new UI.Widget.VBox();
    mainContainer.setMinimumSize(100, 0);
    this.storageViews = mainContainer.element.createChild('div', 'vbox flex-auto');
    this.storageViewToolbar = mainContainer.element.createChild('devtools-toolbar', 'resources-toolbar');
    this.splitWidget().setMainWidget(mainContainer);

    this.mmkvStorageView = null;

    this.sidebar = new StoragePanelSidebar(this);
    this.sidebar.show(this.panelSidebarElement());
  }

  static instance(opts: {
    forceNew: boolean|null,
  } = {forceNew: null}): StoragePanel {
    const {forceNew} = opts;
    if (!storagePanelInstance || forceNew) {
      storagePanelInstance = new StoragePanel();
    }

    return storagePanelInstance;
  }

  override focus(): void {
    this.sidebar.focus();
  }

  resetView(): void {
    if (this.visibleView) {
      this.showView(null);
    }
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

  async scheduleShowView(viewPromise: Promise<UI.Widget.Widget>): Promise<UI.Widget.Widget|null> {
    this.pendingViewPromise = viewPromise;
    const view = await viewPromise;
    if (this.pendingViewPromise !== viewPromise) {
      return null;
    }
    this.showView(view);
    return view;
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
      categoryName: string, categoryHeadline: string, categoryDescription: string,
      _categoryLink: Platform.DevToolsPath.UrlString|null): void {
    // Create a simple category view / 간단한 카테고리 뷰 생성
    const categoryView = new UI.Widget.VBox();
    categoryView.element.classList.add('storage-category-view');
    const headline = categoryView.element.createChild('div', 'storage-category-headline');
    headline.textContent = categoryHeadline;
    const description = categoryView.element.createChild('div', 'storage-category-description');
    description.textContent = categoryDescription;
    this.showView(categoryView);
  }
}

// Storage Panel Sidebar / Storage 패널 사이드바
export class StoragePanelSidebar extends UI.Widget.VBox {
  private readonly panel: StoragePanel;
  private readonly sidebarTree: UI.TreeOutline.TreeOutlineInShadow;
  mmkvListTreeElement: ExpandableStoragePanelTreeElement;
  asyncStorageListTreeElement: ExpandableStoragePanelTreeElement;
  private mmkvStorageTreeElements: Map<MMKVStorage, MMKVStorageTreeElement>;

  constructor(panel: StoragePanel) {
    super();
    this.panel = panel;
    this.element.classList.add('storage-panel-sidebar');
    this.sidebarTree = new UI.TreeOutline.TreeOutlineInShadow();
    this.sidebarTree.element.classList.add('storage-panel-sidebar-tree');
    this.sidebarTree.setFocusable(true);
    this.element.appendChild(this.sidebarTree.element);

    this.mmkvStorageTreeElements = new Map();

    // Create MMKV section / MMKV 섹션 생성
    this.mmkvListTreeElement = new ExpandableStoragePanelTreeElement(
        this.panel, 'MMKV', 'No MMKV storage detected',
        'On this page you can view, add, edit, and delete MMKV storage key-value pairs.', 'mmkv-storage');
    const mmkvIcon = createIcon('table');
    this.mmkvListTreeElement.setLeadingIcons([mmkvIcon]);
    this.sidebarTree.appendChild(this.mmkvListTreeElement);

    // Create AsyncStorage section / AsyncStorage 섹션 생성
    this.asyncStorageListTreeElement = new ExpandableStoragePanelTreeElement(
        this.panel, 'AsyncStorage', 'No AsyncStorage detected',
        'On this page you can view, add, edit, and delete AsyncStorage key-value pairs.', 'async-storage');
    const asyncStorageIcon = createIcon('table');
    this.asyncStorageListTreeElement.setLeadingIcons([asyncStorageIcon]);
    this.sidebarTree.appendChild(this.asyncStorageListTreeElement);

    // Listen to model changes / 모델 변경 감지
    SDK.TargetManager.TargetManager.instance().observeModels(
        MMKVStorageModel, {
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
    const mmkvStorage = event.data;
    this.addMMKVStorage(mmkvStorage);
  };

  private addMMKVStorage(mmkvStorage: MMKVStorage): void {
    // Check if already added / 이미 추가되었는지 확인
    if (this.mmkvStorageTreeElements.has(mmkvStorage)) {
      return;
    }

    const mmkvStorageTreeElement = new MMKVStorageTreeElement(this.panel, mmkvStorage);
    this.mmkvStorageTreeElements.set(mmkvStorage, mmkvStorageTreeElement);
    this.mmkvListTreeElement.appendChild(mmkvStorageTreeElement, comparator);

    function comparator(a: UI.TreeOutline.TreeElement, b: UI.TreeOutline.TreeElement): number {
      const aTitle = a.titleAsText().toLocaleLowerCase();
      const bTitle = b.titleAsText().toLocaleLowerCase();
      return aTitle.localeCompare(bTitle);
    }
  }

  private mmkvStorageRemoved = (event: Common.EventTarget.EventTargetEvent<MMKVStorage>): void => {
    const mmkvStorage = event.data;
    this.removeMMKVStorage(mmkvStorage);
  };

  private removeMMKVStorage(mmkvStorage: MMKVStorage): void {
    const treeElement = this.mmkvStorageTreeElements.get(mmkvStorage);
    if (!treeElement) {
      return;
    }
    const wasSelected = treeElement.selected;
    this.mmkvListTreeElement.removeChild(treeElement);
    this.mmkvStorageTreeElements.delete(mmkvStorage);
    if (wasSelected && this.mmkvListTreeElement.childCount() > 0) {
      const firstChild = this.mmkvListTreeElement.childAt(0);
      if (firstChild) {
        firstChild.select();
      }
    }
  }
}

// Storage Panel Tree Element / Storage 패널 트리 엘리먼트
class StoragePanelTreeElement extends UI.TreeOutline.TreeElement {
  protected readonly storagePanel: StoragePanel;

  constructor(storagePanel: StoragePanel, title: string, expandable: boolean, jslogContext: string) {
    super(title, expandable, jslogContext);
    this.storagePanel = storagePanel;
    UI.ARIAUtils.setLabel(this.listItemElement, title);
    this.listItemElement.tabIndex = -1;
  }

  override deselect(): void {
    super.deselect();
    this.listItemElement.tabIndex = -1;
  }

  get itemURL(): Platform.DevToolsPath.UrlString {
    throw new Error('Unimplemented Method');
  }

  override onselect(_selectedByUser: boolean|undefined): boolean {
    return false;
  }

  showView(view: UI.Widget.Widget|null): void {
    this.storagePanel.showView(view);
  }
}

// Expandable Storage Panel Tree Element / 확장 가능한 Storage 패널 트리 엘리먼트
class ExpandableStoragePanelTreeElement extends StoragePanelTreeElement {
  protected readonly expandedSetting: Common.Settings.Setting<boolean>;
  protected readonly categoryName: string;
  protected categoryLink: Platform.DevToolsPath.UrlString|null;
  protected emptyCategoryHeadline: string;
  protected categoryDescription: string;

  constructor(
      storagePanel: StoragePanel, categoryName: string, emptyCategoryHeadline: string, categoryDescription: string,
      settingsKey: string, settingsDefault = false) {
    super(storagePanel, categoryName, false, settingsKey);
    this.expandedSetting =
        Common.Settings.Settings.instance().createSetting('storage-' + settingsKey + '-expanded', settingsDefault);
    this.categoryName = categoryName;
    this.categoryLink = null;
    this.emptyCategoryHeadline = emptyCategoryHeadline;
    this.categoryDescription = categoryDescription;
  }

  override get itemURL(): Platform.DevToolsPath.UrlString {
    return 'category://' + this.categoryName as Platform.DevToolsPath.UrlString;
  }

  override onselect(selectedByUser?: boolean): boolean {
    super.onselect(selectedByUser);
    this.storagePanel.showCategoryView(
        this.categoryName, this.emptyCategoryHeadline, this.categoryDescription, this.categoryLink);
    return false;
  }

  override onexpand(): void {
    this.expandedSetting.set(true);
  }

  override oncollapse(): void {
    this.expandedSetting.set(false);
  }

  override onattach(): void {
    super.onattach();
    if (this.expandedSetting.get()) {
      this.expand();
    }
  }
}

// MMKV Storage Tree Element / MMKV 스토리지 트리 엘리먼트
class MMKVStorageTreeElement extends StoragePanelTreeElement {
  private readonly mmkvStorage: MMKVStorage;
  constructor(storagePanel: StoragePanel, mmkvStorage: MMKVStorage) {
    super(
        storagePanel,
        mmkvStorage.instanceId === 'default' ? 'MMKV (default)' : `MMKV (${mmkvStorage.instanceId})`,
        false, 'mmkv-storage-for-instance');
    this.mmkvStorage = mmkvStorage;
    const icon = createIcon('table');
    this.setLeadingIcons([icon]);
    this.listItemElement.setAttribute('jslog', `${VisualLogging.treeItem('mmkv-storage-instance')}`);
  }

  override get itemURL(): Platform.DevToolsPath.UrlString {
    return 'mmkv-storage://' + this.mmkvStorage.instanceId as Platform.DevToolsPath.UrlString;
  }

  override onselect(_selectedByUser?: boolean): boolean {
    super.onselect(_selectedByUser);
    this.storagePanel.showMMKVStorage(this.mmkvStorage);
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
