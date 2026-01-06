// Copyright 2025 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as UI from '../../ui/legacy/legacy.js';
import * as Platform from '../../core/platform/platform.js';
import * as SDK from '../../core/sdk/sdk.js';
import * as ProtocolClient from '../../core/protocol_client/protocol_client.js';
import * as Root from '../../core/root/root.js';
import { ReduxExtensionBridge } from './ReduxExtensionBridge.js';

export class ReduxPanel extends UI.Panel.Panel {
  #iframe: HTMLIFrameElement | null = null;
  #bridge: ReduxExtensionBridge;
  #target: SDK.Target.Target | null = null;
  #targetListener: (() => void)|null = null;
  #setupAttempted: boolean = false;

  constructor() {
    super('redux');
    this.setHideOnDetach();

    this.#bridge = new ReduxExtensionBridge();

    // Create iframe directly / iframe 직접 생성
    this.#iframe = document.createElement('iframe');
    this.#iframe.className = 'redux-devtools-iframe';
    this.#iframe.style.width = '100%';
    this.#iframe.style.height = '100%';
    this.#iframe.style.border = 'none';

    // Build URL for devpanel.html / devpanel.html URL 구성
    // Use the same base URL as the current page / 현재 페이지와 동일한 base URL 사용
    const remoteBase = Root.Runtime.getRemoteBase();
    let reduxDevToolsPage: Platform.DevToolsPath.UrlString;
    if (remoteBase) {
      // Use remote base if available / remote base가 있으면 사용
      reduxDevToolsPage = `${remoteBase.base}panels/redux/extension/devpanel.html` as Platform.DevToolsPath.UrlString;
    } else {
      // Fallback to relative path / 상대 경로로 폴백
      const currentPath = window.location.pathname;
      const basePath = currentPath.substring(0, currentPath.lastIndexOf('/'));
      reduxDevToolsPage = `${basePath}/panels/redux/extension/devpanel.html` as Platform.DevToolsPath.UrlString;
    }
    this.#iframe.src = reduxDevToolsPage;

    // Listen for errors in iframe / iframe 내부 에러 리스닝
    this.#iframe.onerror = (event) => {
      console.error('[ReduxPanel] iframe error:', event);
    };

    this.#iframe.onload = () => {
      console.log('[ReduxPanel] iframe loaded');
      if (this.#iframe?.contentWindow) {
        // Initialize bridge - API stub is already injected by build script / 브릿지 초기화 - API stub은 이미 빌드 스크립트에서 주입됨
        // Replace stub with actual implementation / stub을 실제 구현으로 교체
        console.log('[ReduxPanel] Initializing bridge with iframe window');
        this.#bridge.initialize(this.#iframe.contentWindow);

        // Listen for errors in iframe content window / iframe content window의 에러 리스닝
        this.#iframe.contentWindow.addEventListener('error', (event) => {
          console.error(
              '[ReduxPanel] iframe content error:', event.error, event.message, event.filename, event.lineno,
              event.colno);
        });

        // Listen for unhandled promise rejections / 처리되지 않은 Promise 거부 리스닝
        this.#iframe.contentWindow.addEventListener('unhandledrejection', (event) => {
          console.error('[ReduxPanel] iframe unhandled rejection:', event.reason);
        });

        // Check if Redux DevTools Extension is ready / Redux DevTools Extension이 준비되었는지 확인
        setTimeout(() => {
          if (this.#iframe?.contentWindow) {
            const win = this.#iframe.contentWindow as any;
            console.log('[ReduxPanel] Checking iframe state:', {
              hasChrome: !!win.chrome,
              hasRuntime: !!win.chrome?.runtime,
              hasConnect: typeof win.chrome?.runtime?.connect === 'function',
              hasDevtools: !!win.chrome?.devtools,
              hasInspectedWindow: !!win.chrome?.devtools?.inspectedWindow,
              tabId: win.chrome?.devtools?.inspectedWindow?.tabId,
            });

            // Try to manually trigger init if it hasn't been called / init이 호출되지 않았다면 수동으로 트리거 시도
            if (win.chrome && win.chrome.runtime && typeof win.chrome.runtime.connect === 'function') {
              console.log('[ReduxPanel] Attempting to check if init() was called...');
              // Check if bgConnection exists (from devpanel/index.tsx) / bgConnection이 존재하는지 확인
              try {
                const hasBgConnection = 'bgConnection' in win || (win as any).bgConnection !== undefined;
                console.log('[ReduxPanel] bgConnection exists:', hasBgConnection);
              } catch (e) {
                console.log('[ReduxPanel] Could not check bgConnection:', e);
              }
            }
          }
        }, 1000);

        // Also check after a longer delay to see if connect was called / 더 긴 지연 후 connect가 호출되었는지 확인
        setTimeout(() => {
          console.log('[ReduxPanel] Delayed check - bridge ports:', this.#bridge.getPortsCount?.() || 'N/A');
        }, 3000);
      }
    };

    this.contentElement.appendChild(this.#iframe);

    // Setup CDP listener / CDP 리스너 설정
    this.setupCDPListener();
  }

  override wasShown(): void {
    super.wasShown();
    this.setupCDPListener();
  }

  override willHide(): void {
    super.willHide();
    this.cleanupCDPListener();
  }


  private setupCDPListener(): void {
    console.log('[ReduxPanel] setupCDPListener called');

    // 이미 타겟이 연결되어 있으면 다시 연결하지 않음 / 이미 타겟이 연결되어 있으면 다시 연결하지 않음
    if (this.#target) {
      console.log('[ReduxPanel] Target already attached, skipping...');
      return;
    }

    // 이미 설정 시도 중이면 중복 방지 / 이미 설정 시도 중이면 중복 방지
    if (this.#setupAttempted) {
      console.log('[ReduxPanel] Setup already attempted, skipping...');
      return;
    }

    this.#setupAttempted = true;

    const tryAttachTarget = (): void => {
      const target = SDK.TargetManager.TargetManager.instance().primaryPageTarget();
      if (target && !this.#target) {
        console.log('[ReduxPanel] Target found, attaching...', target);
        this.#target = target;
        this.attachToTarget(target);
        // 리스너 제거 / 리스너 제거
        if (this.#targetListener) {
          SDK.TargetManager.TargetManager.instance().removeEventListener(
              SDK.TargetManager.Events.AVAILABLE_TARGETS_CHANGED, this.#targetListener, this);
          this.#targetListener = null;
        }
      }
    };

    // 즉시 시도 / 즉시 시도
    tryAttachTarget();

    if (!this.#target) {
      console.log('[ReduxPanel] No target available, waiting for target...');

      // 이벤트 리스너 등록 / 이벤트 리스너 등록
      this.#targetListener = () => {
        tryAttachTarget();
      };

      SDK.TargetManager.TargetManager.instance().addEventListener(
          SDK.TargetManager.Events.AVAILABLE_TARGETS_CHANGED, this.#targetListener, this);

      // 타겟이 이미 준비되어 있을 수 있으므로 여러 번 확인 / 타겟이 이미 준비되어 있을 수 있으므로 여러 번 확인
      const checkIntervals = [50, 100, 200, 500, 1000];
      checkIntervals.forEach((delay) => {
        setTimeout(() => {
          if (!this.#target) {
            tryAttachTarget();
          }
        }, delay);
      });
    }
  }

  private attachToTarget(target: SDK.Target.Target): void {
    console.log('[ReduxPanel] attachToTarget called', target);
    const router = target.router();
    if (!router?.connection) {
      console.warn('[ReduxPanel] No router or connection available');
      return;
    }

    console.log('[ReduxPanel] Attaching bridge to target connection');
    // Redux CDP 이벤트를 bridge로 전달 / Redux CDP 이벤트를 bridge로 전달
    this.#bridge.attachToTarget(target, router.connection);
  }

  private cleanupCDPListener(): void {
    this.#bridge.cleanup();
    // 리스너 제거 / 리스너 제거
    if (this.#targetListener) {
      SDK.TargetManager.TargetManager.instance().removeEventListener(
          SDK.TargetManager.Events.AVAILABLE_TARGETS_CHANGED, this.#targetListener, this);
      this.#targetListener = null;
    }
    this.#target = null;
    this.#setupAttempted = false;
  }
}


