// Copyright 2025 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as UI from '../../ui/legacy/legacy.js';
import * as SDK from '../../core/sdk/sdk.js';
import * as ProtocolClient from '../../core/protocol_client/protocol_client.js';
import type * as Protocol from '../../generated/protocol.js';

let sessionReplayPanelInstance: SessionReplayPanel;

export class SessionReplayPanel extends UI.Panel.Panel {
  #rrwebEvents: unknown[] = [];
  #container: HTMLElement|null = null;
  #target: SDK.Target.Target|null = null;
  #observer: ProtocolClient.CDPConnection.CDPConnectionObserver|null = null;
  #replayer: any = null; // Replayer instance / Replayer 인스턴스
  #rrwebLoaded = false; // Flag to track if rrweb is loaded / rrweb 로드 여부 플래그

  constructor() {
    super('session-replay');
    this.setupCDPListener();
    this.render();
  }

  private setupCDPListener(): void {
    // Get primary target and listen to CDP events / 주요 타겟을 가져와서 CDP 이벤트 리스닝
    const target = SDK.TargetManager.TargetManager.instance().primaryPageTarget();
    if (!target) {
      // Wait for target to be available / 타겟이 사용 가능할 때까지 대기
      SDK.TargetManager.TargetManager.instance().addEventListener(
        SDK.TargetManager.Events.AVAILABLE_TARGETS_CHANGED,
        () => {
          const newTarget = SDK.TargetManager.TargetManager.instance().primaryPageTarget();
          if (newTarget && !this.#target) {
            this.#target = newTarget;
            this.attachToTarget(newTarget);
          }
        },
        this
      );
      return;
    }

    this.#target = target;
    this.attachToTarget(target);
  }

  private attachToTarget(target: SDK.Target.Target): void {
    // Listen to SessionReplay.eventRecorded events / SessionReplay.eventRecorded 이벤트 리스닝
    const router = target.router();
    if (!router) return;

    const connection = router.connection;
    if (!connection) return;

    this.#observer = {
      onEvent: <T extends ProtocolClient.CDPConnection.Event>(event: ProtocolClient.CDPConnection.CDPEvent<T>): void => {
        // Check for SessionReplay.eventRecorded event / SessionReplay.eventRecorded 이벤트 확인
        if (event.method === 'SessionReplay.eventRecorded') {
          const params = event.params as Protocol.SessionReplay.EventRecordedEvent;
          if (Array.isArray(params.events)) {
            this.#rrwebEvents.push(...params.events);
            this.updateReplay();
          }
        }
      },
      onDisconnect: (_reason: string): void => {
        this.#observer = null;
      },
    };

    connection.observe(this.#observer);
  }

  private render(): void {
    const container = document.createElement('div');
    container.className = 'session-replay-panel';
    this.#container = container;
    this.contentElement.appendChild(container);
    this.updateReplay();
  }

  private updateReplay(): void {
    if (!this.#container) return;

    // Check if we have enough events for replay / 재생에 충분한 이벤트가 있는지 확인
    const hasFullSnapshot = this.#rrwebEvents.some(
      (event: unknown) => (event as {type?: number}).type === 2
    );

    if (this.#rrwebEvents.length < 2 || !hasFullSnapshot) {
      this.#container.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #999;">
          Waiting for full snapshot... (${this.#rrwebEvents.length} events)
        </div>
      `;
      return;
    }

    // TODO: Initialize rrweb-player here / 여기서 rrweb-player 초기화
    this.#container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #999;">
        Replay ready (${this.#rrwebEvents.length} events)
      </div>
    `;
  }

  static instance(opts: {forceNew: boolean|null} = {forceNew: null}): SessionReplayPanel {
    const {forceNew} = opts;
    if (!sessionReplayPanelInstance || forceNew) {
      sessionReplayPanelInstance = new SessionReplayPanel();
    }
    return sessionReplayPanelInstance;
  }
}

