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

export class AsyncStorageStorage extends Common.ObjectWrapper.ObjectWrapper<AsyncStorageStorage.EventTypes> {
  private readonly model: AsyncStorageStorageModel;
  readonly #instanceId: string;

  constructor(model: AsyncStorageStorageModel, instanceId: string) {
    super();
    this.model = model;
    this.#instanceId = instanceId;
  }

  get instanceId(): string {
    return this.#instanceId;
  }

  getItems(): Promise<Protocol.AsyncStorageStorage.Item[]|null> {
    // Use CDP command - client will handle via registered handler / CDP 명령 사용 - 클라이언트가 등록된 핸들러를 통해 처리
    // Handler routes based on method name / 핸들러가 메서드 이름을 기준으로 라우팅
    return this.model.agent.invoke_getAsyncStorageItems({instanceId: this.instanceId}).then(({entries}: {entries: Protocol.AsyncStorageStorage.Item[]|null}) => entries);
  }

  setItem(key: string, value: string): void {
    void this.model.agent.invoke_setAsyncStorageItem({instanceId: this.instanceId, key, value});
  }

  removeItem(key: string): void {
    void this.model.agent.invoke_removeAsyncStorageItem({instanceId: this.instanceId, key});
  }

  clear(): void {
    void this.model.agent.invoke_clear({instanceId: this.instanceId});
  }
}

export namespace AsyncStorageStorage {
  export const enum Events {
    ASYNC_STORAGE_ITEMS_CLEARED = 'AsyncStorageItemsCleared',
    ASYNC_STORAGE_ITEM_REMOVED = 'AsyncStorageItemRemoved',
    ASYNC_STORAGE_ITEM_ADDED = 'AsyncStorageItemAdded',
    ASYNC_STORAGE_ITEM_UPDATED = 'AsyncStorageItemUpdated',
  }

  export interface AsyncStorageItemRemovedEvent {
    key: string;
  }

  export interface AsyncStorageItemAddedEvent {
    key: string;
    value: string;
  }

  export interface AsyncStorageItemUpdatedEvent {
    key: string;
    oldValue: string;
    value: string;
  }

  export interface EventTypes {
    [Events.ASYNC_STORAGE_ITEMS_CLEARED]: void;
    [Events.ASYNC_STORAGE_ITEM_REMOVED]: AsyncStorageItemRemovedEvent;
    [Events.ASYNC_STORAGE_ITEM_ADDED]: AsyncStorageItemAddedEvent;
    [Events.ASYNC_STORAGE_ITEM_UPDATED]: AsyncStorageItemUpdatedEvent;
  }
}

export class AsyncStorageStorageModel extends SDK.SDKModel.SDKModel<EventTypes> {
  #storages: Map<string, AsyncStorageStorage>;
  readonly agent: ProtocolProxyApi.AsyncStorageStorageApi;
  private enabled?: boolean;

  constructor(target: SDK.Target.Target) {
    super(target);

    this.#storages = new Map();
    this.agent = target.asyncStorageStorageAgent();
  }

  enable(): void {
    if (this.enabled) {
      return;
    }

    this.target().registerAsyncStorageStorageDispatcher(new AsyncStorageStorageDispatcher(this));
    void this.agent.invoke_enable();

    this.enabled = true;
  }

  asyncStorageItemsCleared({instanceId}: Protocol.AsyncStorageStorage.AsyncStorageItemsClearedEvent): void {
    const asyncStorageStorage = this.storageForInstanceId(instanceId);
    if (!asyncStorageStorage) {
      return;
    }

    asyncStorageStorage.dispatchEventToListeners(AsyncStorageStorage.Events.ASYNC_STORAGE_ITEMS_CLEARED);
  }

  asyncStorageItemRemoved({instanceId, key}: Protocol.AsyncStorageStorage.AsyncStorageItemRemovedEvent): void {
    const asyncStorageStorage = this.storageForInstanceId(instanceId);
    if (!asyncStorageStorage) {
      return;
    }

    const eventData = {key};
    asyncStorageStorage.dispatchEventToListeners(AsyncStorageStorage.Events.ASYNC_STORAGE_ITEM_REMOVED, eventData);
  }

  asyncStorageItemAdded({instanceId, key, newValue}: Protocol.AsyncStorageStorage.AsyncStorageItemAddedEvent): void {
    let asyncStorageStorage = this.storageForInstanceId(instanceId);
    if (!asyncStorageStorage) {
      // Create storage if it doesn't exist / 존재하지 않으면 스토리지 생성
      asyncStorageStorage = this.addStorage(instanceId);
    }

    const eventData = {key, value: newValue};
    asyncStorageStorage.dispatchEventToListeners(AsyncStorageStorage.Events.ASYNC_STORAGE_ITEM_ADDED, eventData);
  }

  asyncStorageItemUpdated({instanceId, key, oldValue, newValue}: Protocol.AsyncStorageStorage.AsyncStorageItemUpdatedEvent): void {
    const asyncStorageStorage = this.storageForInstanceId(instanceId);
    if (!asyncStorageStorage) {
      return;
    }

    const eventData = {key, oldValue, value: newValue};
    asyncStorageStorage.dispatchEventToListeners(AsyncStorageStorage.Events.ASYNC_STORAGE_ITEM_UPDATED, eventData);
  }

  asyncStorageInstanceCreated({instanceId}: Protocol.AsyncStorageStorage.AsyncStorageInstanceCreatedEvent): void {
    // Create storage for new instance / 새 인스턴스에 대한 스토리지 생성
    this.addStorage(instanceId);
  }

  private addStorage(instanceId: string): AsyncStorageStorage {
    const existing = this.#storages.get(instanceId);
    if (existing) {
      return existing;
    }

    const storage = new AsyncStorageStorage(this, instanceId);
    this.#storages.set(instanceId, storage);
    this.dispatchEventToListeners(Events.ASYNC_STORAGE_ADDED, storage);
    return storage;
  }

  private storageForInstanceId(instanceId: string): AsyncStorageStorage|null {
    return this.#storages.get(instanceId) || null;
  }

  storages(): AsyncStorageStorage[] {
    return Array.from(this.#storages.values());
  }
}

SDK.SDKModel.SDKModel.register(AsyncStorageStorageModel, {capabilities: SDK.Target.Capability.NONE, autostart: false});

export const enum Events {
  ASYNC_STORAGE_ADDED = 'AsyncStorageStorageAdded',
  ASYNC_STORAGE_REMOVED = 'AsyncStorageStorageRemoved',
}

export interface EventTypes {
  [Events.ASYNC_STORAGE_ADDED]: AsyncStorageStorage;
  [Events.ASYNC_STORAGE_REMOVED]: AsyncStorageStorage;
}

export class AsyncStorageStorageDispatcher implements ProtocolProxyApi.AsyncStorageStorageDispatcher {
  private readonly model: AsyncStorageStorageModel;
  constructor(model: AsyncStorageStorageModel) {
    this.model = model;
  }

  asyncStorageItemsCleared({instanceId}: Protocol.AsyncStorageStorage.AsyncStorageItemsClearedEvent): void {
    this.model.asyncStorageItemsCleared({instanceId});
  }

  asyncStorageItemRemoved({instanceId, key}: Protocol.AsyncStorageStorage.AsyncStorageItemRemovedEvent): void {
    this.model.asyncStorageItemRemoved({instanceId, key});
  }

  asyncStorageItemAdded({instanceId, key, newValue}: Protocol.AsyncStorageStorage.AsyncStorageItemAddedEvent): void {
    this.model.asyncStorageItemAdded({instanceId, key, newValue});
  }

  asyncStorageItemUpdated({instanceId, key, oldValue, newValue}: Protocol.AsyncStorageStorage.AsyncStorageItemUpdatedEvent): void {
    this.model.asyncStorageItemUpdated({instanceId, key, oldValue, newValue});
  }

  asyncStorageInstanceCreated({instanceId}: Protocol.AsyncStorageStorage.AsyncStorageInstanceCreatedEvent): void {
    this.model.asyncStorageInstanceCreated({instanceId});
  }
}
