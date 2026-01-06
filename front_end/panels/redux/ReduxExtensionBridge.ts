// Copyright 2025 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as SDK from '../../core/sdk/sdk.js';
import * as ProtocolClient from '../../core/protocol_client/protocol_client.js';
import * as Protocol from '../../generated/protocol.js';

/**
 * Port interface matching Chrome Extension API / Chrome Extension API와 일치하는 Port 인터페이스
 */
interface ChromePort {
  name: string;
  onMessage: {
    addListener: (callback: (message: any) => void) => void; removeListener: (callback: (message: any) => void) => void;
  };
  onDisconnect: {addListener: (callback: () => void) => void;};
  postMessage: (message: any) => void;
  disconnect: () => void;
}

/**
 * Redux DevTools Extension과의 통신 브릿지 / Redux DevTools Extension과의 통신 브릿지
 * Extension의 chrome.runtime API를 시뮬레이션하고 CDP 메시지를 Extension 형식으로 변환 / Extension의 chrome.runtime API를 시뮬레이션하고 CDP 메시지를 Extension 형식으로 변환
 */
export class ReduxExtensionBridge {
  private iframeWindow: Window | null = null;
  private target: SDK.Target.Target | null = null;
  private observer: ProtocolClient.CDPConnection.CDPConnectionObserver | null = null;
  private ports: Map<string, ChromePort> = new Map();
  private portListeners: Map<ChromePort, Array<(message: any) => void>> = new Map();
  private disconnectListeners: Map<ChromePort, Array<() => void>> = new Map();
  private messageListeners: Array<(message: any, sender: any, sendResponse: (response: any) => void) => void> = [];

  /**
   * Initialize bridge with iframe window / iframe window로 브릿지 초기화
   */
  initialize(iframeWindow: Window): void {
    this.iframeWindow = iframeWindow;
    this.injectExtensionAPI();
  }

  /**
   * Create a Chrome Port object / Chrome Port 객체 생성
   */
  private createPort(name: string): ChromePort {
    console.log('[ReduxExtensionBridge] createPort called:', name);
    const messageListeners: Array<(message: any) => void> = [];
    const disconnectListeners: Array<() => void> = [];

    const port: ChromePort = {
      name,
      onMessage: {
        addListener: (callback: (message: any) => void) => {
          messageListeners.push(callback);
          console.log(
              '[ReduxExtensionBridge] Message listener added to port:', name,
              'Total listeners:', messageListeners.length);

          // 'monitor' 포트에 첫 번째 리스너가 등록되면 현재 상태 요청 / 'monitor' 포트에 첫 번째 리스너가 등록되면 현재 상태 요청
          // 이것은 Redux DevTools Extension의 devpanel이 연결되었음을 의미 / 이것은 Redux DevTools Extension의 devpanel이 연결되었음을 의미
          if (messageListeners.length === 1 && name.startsWith('monitor')) {
            console.log('[ReduxExtensionBridge] DevTools panel connected, requesting current state');
            setTimeout(() => {
              this.requestCurrentState();
            }, 100);
          }
        },
        removeListener: (callback: (message: any) => void) => {
          const index = messageListeners.indexOf(callback);
          if (index > -1) {
            messageListeners.splice(index, 1);
          }
        },
      },
      onDisconnect: {
        addListener: (callback: () => void) => {
          disconnectListeners.push(callback);
        },
      },
      postMessage: (message: any) => {
        // Handle message from extension / extension으로부터 메시지 처리
        this.handleExtensionMessage(message, port);
      },
      disconnect: () => {
        // Trigger disconnect listeners / disconnect 리스너 트리거
        disconnectListeners.forEach((listener) => listener());
        this.ports.delete(name);
        this.portListeners.delete(port);
        this.disconnectListeners.delete(port);
      },
    };

    this.ports.set(name, port);
    this.portListeners.set(port, messageListeners);
    this.disconnectListeners.set(port, disconnectListeners);

    return port;
  }

  /**
   * Send message to a port / port로 메시지 전송
   */
  private sendToPort(port: ChromePort, message: any): void {
    const listeners = this.portListeners.get(port);
    console.log('[ReduxExtensionBridge] sendToPort - listeners count:', listeners?.length || 0);
    if (listeners && listeners.length > 0) {
      listeners.forEach((listener) => {
        try {
          console.log('[ReduxExtensionBridge] Calling listener with message:', message);
          listener(message);
        } catch (error) {
          console.error('[ReduxExtensionBridge] Error in port message listener:', error);
        }
      });
    } else {
      console.warn('[ReduxExtensionBridge] No listeners registered for port');
    }
  }

  /**
   * Inject chrome.runtime API into iframe / iframe에 chrome.runtime API 주입
   * Note: API stub is already injected by build script, this replaces it with actual implementation / 참고: API stub은 이미 빌드 스크립트에서 주입됨, 이것은 실제 구현으로 교체함
   */
  private injectExtensionAPI(): void {
    if (!this.iframeWindow) {
      console.warn('[ReduxExtensionBridge] No iframe window available');
      return;
    }

    console.log('[ReduxExtensionBridge] Injecting extension API into iframe');

    // Ensure chrome object exists (stub should already be there from build script) / chrome 객체가 존재하는지 확인 (stub은 이미 빌드 스크립트에서 주입됨)
    if (!(this.iframeWindow as any).chrome) {
      console.log('[ReduxExtensionBridge] Creating chrome object (stub not found)');
      (this.iframeWindow as any).chrome = {};
    } else {
      console.log('[ReduxExtensionBridge] Chrome object already exists');
    }

    // Replace stub with actual implementation / stub을 실제 구현으로 교체
    // Redux DevTools Extension이 사용하는 chrome.runtime API 시뮬레이션 / Redux DevTools Extension이 사용하는 chrome.runtime API 시뮬레이션
    (this.iframeWindow as any).chrome.runtime = {
      // Connect to background script / background script에 연결
      connect: (options?: {name?: string}) => {
        const name = options?.name || 'default';
        console.log('[ReduxExtensionBridge] ✅ chrome.runtime.connect() called with name:', name, 'options:', options);
        console.trace('[ReduxExtensionBridge] Stack trace for connect() call');
        const port = this.createPort(name);
        console.log('[ReduxExtensionBridge] Port created, total ports:', this.ports.size, 'port name:', name);
        return port;
      },
      // Send message to background script / background script로 메시지 전송
      sendMessage: (message: any, callback?: (response: any) => void) => {
        this.handleExtensionMessage(message, null);
        if (callback) {
          callback({success: true});
        }
      },
      // Listen to messages from background script / background script로부터 메시지 수신
      onMessage: {
        addListener: (callback: (message: any, sender: any, sendResponse: (response: any) => void) => void) => {
          this.messageListeners.push(callback);
        },
        removeListener: (callback: (message: any, sender: any, sendResponse: (response: any) => void) => void) => {
          const index = this.messageListeners.indexOf(callback);
          if (index > -1) {
            this.messageListeners.splice(index, 1);
          }
        },
      },
      // Listen to connections / 연결 리스닝
      onConnect: {
        addListener: (callback: (port: ChromePort) => void) => {
            // When extension calls connect, trigger callback / extension이 connect를 호출하면 콜백 트리거
            // This is handled in connect() method / 이것은 connect() 메서드에서 처리됨
        },
      },
      // Get URL for extension resource / extension 리소스 URL 가져오기
      getURL: (path: string) => {
        return `devtools://devtools/bundled/panels/redux/extension/${path}`;
      },
    };

    // Ensure devtools object exists / devtools 객체가 존재하는지 확인
    if (!(this.iframeWindow as any).chrome.devtools) {
      (this.iframeWindow as any).chrome.devtools = {};
    }
    if (!(this.iframeWindow as any).chrome.devtools.inspectedWindow) {
      (this.iframeWindow as any).chrome.devtools.inspectedWindow = {};
    }

    (this.iframeWindow as any).chrome.devtools.inspectedWindow = {
      // Evaluate script in inspected page / inspected page에서 스크립트 실행
      eval: (expression: string, callback?: (result: any, exceptionInfo?: any) => void) => {
        this.evaluateInInspectedPage(expression, callback);
      },
      // Get resources from inspected page / inspected page에서 리소스 가져오기
      getResources: (callback: (resources: Array<{url: string}>) => void) => {
        // Return mock resource to prevent undefined access / undefined 접근을 방지하기 위해 모의 리소스 반환
        if (callback) {
          // Return a mock resource with a valid URL / 유효한 URL을 가진 모의 리소스 반환
          callback([{url: this.iframeWindow?.location?.href || window.location.href || 'about:blank'}]);
        }
      },
      // Get tab ID / 탭 ID 가져오기
      // Redux DevTools Extension uses tabId to create unique port name / Redux DevTools Extension은 tabId를 사용하여 고유한 port 이름 생성
      // Return 0 as default to avoid 'monitorundefined' / 'monitorundefined'를 방지하기 위해 기본값으로 0 반환
      get tabId(): number |
          undefined {
            // Return 0 as default tab ID / 기본 탭 ID로 0 반환
            return 0;
          },
    };
  }

  /**
   * Handle messages from Redux DevTools Extension / Redux DevTools Extension으로부터 메시지 처리
   */
  private handleExtensionMessage(message: any, port: ChromePort|null): void {
    // Redux DevTools Extension의 메시지를 처리 / Redux DevTools Extension의 메시지를 처리
    console.log('[ReduxExtensionBridge] Received message from extension:', message);

    // Trigger onMessage listeners / onMessage 리스너 트리거
    this.messageListeners.forEach((listener) => {
      try {
        listener(message, {tab: {id: undefined}}, () => {});
      } catch (error) {
        console.error('[ReduxExtensionBridge] Error in message listener:', error);
      }
    });
  }

  /**
   * Convert CDP message to Redux DevTools Extension message format / CDP 메시지를 Redux DevTools Extension 메시지 형식으로 변환
   * Now the client sends Redux DevTools Extension spec format directly / 이제 클라이언트가 Redux DevTools Extension 스펙 형식을 직접 전송함
   */
  private convertCDPToExtensionMessage(event: ProtocolClient.CDPConnection.CDPEvent<any>): void {
    const params = event.params as any;
    const method = event.method as string;

    console.log('[ReduxExtensionBridge] Received CDP message:', {method, params});

    // Client now sends Redux DevTools Extension spec format directly / 클라이언트가 이제 Redux DevTools Extension 스펙 형식을 직접 전송함
    // Just extract the message from params and forward to ports / params에서 메시지를 추출하여 ports로 전달
    if (method === 'Redux.message' && params.type) {
      const extensionMessage = {
        type: params.type,
        ...params,
      };

      console.log('[ReduxExtensionBridge] Forwarding message to ports:', extensionMessage);
      this.sendToAllPorts(extensionMessage);
    } else {
      console.warn('[ReduxExtensionBridge] Unknown message format:', {method, params});
    }
  }

  /**
   * Get number of connected ports / 연결된 port 수 가져오기
   */
  getPortsCount(): number {
    return this.ports.size;
  }

  /**
   * Send message to all connected ports / 모든 연결된 port로 메시지 전송
   */
  private sendToAllPorts(message: any): void {
    console.log('[ReduxExtensionBridge] Sending to ports:', this.ports.size);
    this.ports.forEach((port, name) => {
      console.log('[ReduxExtensionBridge] Sending to port:', name, message);
      this.sendToPort(port, message);
    });
  }

  /**
   * Attach to target and listen for Redux CDP events / 타겟에 연결하고 Redux CDP 이벤트 리스닝
   */
  attachToTarget(target: SDK.Target.Target, connection: ProtocolClient.CDPConnection.CDPConnection): void {
    console.log('[ReduxExtensionBridge] attachToTarget called', {target, connection});
    this.target = target;

    this.observer = {
      onEvent: (event: ProtocolClient.CDPConnection.CDPEvent<ProtocolClient.CDPConnection.Event>): void => {
        // 모든 이벤트 로깅 (디버깅용) / 모든 이벤트 로깅 (디버깅용)
        const method = event.method as string;

        // Redux 관련 이벤트는 항상 로깅 / Redux 관련 이벤트는 항상 로깅
        if (typeof method === 'string' && (method === 'Redux.message' || method.startsWith('Redux.'))) {
          console.log(
              '[ReduxExtensionBridge] ✅ Redux CDP event received:',
              {method, params: event.params, fullEvent: JSON.stringify(event, null, 2)});
        } else {
          // 다른 이벤트는 일부만 로깅 (너무 많은 로그 방지) / 다른 이벤트는 일부만 로깅 (너무 많은 로그 방지)
          if (method === 'Runtime.executionContextCreated' || method === 'Runtime.consoleAPICalled') {
            console.log('[ReduxExtensionBridge] Ignoring non-Redux event:', method);
          }
        }

        // Redux CDP 이벤트를 Redux DevTools Extension 형식으로 변환 / Redux CDP 이벤트를 Redux DevTools Extension 형식으로 변환
        if (typeof method === 'string' && method === 'Redux.message') {
          console.log('[ReduxExtensionBridge] ✅ Processing Redux.message event');
          this.convertCDPToExtensionMessage(event);
        }
      },
      onDisconnect: (_reason: string): void => {
        console.log('[ReduxExtensionBridge] Connection disconnected:', _reason);
        this.observer = null;
      },
    };

    console.log('[ReduxExtensionBridge] Observing connection...');
    connection.observe(this.observer);
    console.log('[ReduxExtensionBridge] Observer registered');
  }

  /**
   * Evaluate script in inspected page / inspected page에서 스크립트 실행
   */
  private evaluateInInspectedPage(
    expression: string,
    callback?: (result: any, exceptionInfo?: any) => void
  ): void {
    if (!this.target) {
      if (callback) callback(null, { isException: true, value: 'No target available' });
      return;
    }

    const runtimeModel = this.target.model(SDK.RuntimeModel.RuntimeModel);
    if (!runtimeModel) {
      if (callback) callback(null, { isException: true, value: 'No runtime model available' });
      return;
    }

    // Use Runtime API directly / Runtime API 직접 사용
    this.target.runtimeAgent().invoke_evaluate({
      expression: expression,
      returnByValue: true,
    }).then((response: Protocol.Runtime.EvaluateResponse) => {
      if (callback) {
        if (response.exceptionDetails) {
          callback(null, {
            isException: true,
            value: response.exceptionDetails.text || 'Unknown error',
          });
        } else {
          callback(response.result?.value, undefined);
        }
      }
    }).catch((error: Error) => {
      if (callback) callback(null, { isException: true, value: error.message });
    });
  }

  /**
   * Request current state from client via CDP / CDP를 통해 클라이언트로부터 현재 상태 요청
   */
  private requestCurrentState(): void {
    if (!this.target) {
      console.warn('[ReduxExtensionBridge] Cannot request state: no target');
      return;
    }

    console.log('[ReduxExtensionBridge] Requesting current state from client');

    // Evaluate script to trigger state relay / 상태 릴레이를 트리거하기 위해 스크립트 실행
    this.target.runtimeAgent()
        .invoke_evaluate({
          expression: `
        (function() {
          if (window.__REDUX_DEVTOOLS_EXTENSION__ && window.__REDUX_DEVTOOLS_EXTENSION__._requestState) {
            window.__REDUX_DEVTOOLS_EXTENSION__._requestState();
          }
        })();
      `,
          returnByValue: true,
        })
        .catch((error) => {
          console.warn('[ReduxExtensionBridge] Failed to request state:', error);
        });
  }

  /**
   * Cleanup / 정리
   */
  cleanup(): void {
    if (this.observer && this.target) {
      const router = this.target.router();
      if (router?.connection) {
        router.connection.unobserve(this.observer);
      }
      this.observer = null;
    }
    this.messageListeners = [];
    this.ports.clear();
    this.portListeners.clear();
    this.disconnectListeners.clear();
  }
}

