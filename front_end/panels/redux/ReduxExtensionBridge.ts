// Copyright 2025 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as SDK from '../../core/sdk/sdk.js';
import * as ProtocolClient from '../../core/protocol_client/protocol_client.js';
import * as Protocol from '../../generated/protocol.js';

/**
 * Redux DevTools Extension과의 통신 브릿지 / Redux DevTools Extension과의 통신 브릿지
 * Extension의 chrome.runtime API를 시뮬레이션하고 CDP 메시지를 Extension 형식으로 변환 / Extension의 chrome.runtime API를 시뮬레이션하고 CDP 메시지를 Extension 형식으로 변환
 */
export class ReduxExtensionBridge {
  private iframeWindow: Window | null = null;
  private target: SDK.Target.Target | null = null;
  private observer: ProtocolClient.CDPConnection.CDPConnectionObserver | null = null;
  private messagePort: MessagePort | null = null;
  private messageListeners: Array<(message: any) => void> = [];

  /**
   * Initialize bridge with iframe window / iframe window로 브릿지 초기화
   */
  initialize(iframeWindow: Window): void {
    this.iframeWindow = iframeWindow;
    this.injectExtensionAPI();
  }

  /**
   * Inject chrome.runtime API into iframe / iframe에 chrome.runtime API 주입
   */
  private injectExtensionAPI(): void {
    if (!this.iframeWindow) return;

    // MessageChannel을 사용하여 가상의 MessagePort 생성 / MessageChannel을 사용하여 가상의 MessagePort 생성
    const channel = new MessageChannel();
    this.messagePort = channel.port1;

    // MessagePort로 메시지 수신 / MessagePort로 메시지 수신
    this.messagePort.onmessage = (event) => {
      this.handleExtensionMessage(event.data);
    };

    // Redux DevTools Extension이 사용하는 chrome.runtime API 시뮬레이션 / Redux DevTools Extension이 사용하는 chrome.runtime API 시뮬레이션
    (this.iframeWindow as any).chrome = {
      runtime: {
        // Connect to background script / background script에 연결
        connect: (options?: { name?: string }) => {
          // MessagePort를 반환하여 Extension이 통신할 수 있도록 함 / MessagePort를 반환하여 Extension이 통신할 수 있도록 함
          return this.messagePort;
        },
        // Send message to background script / background script로 메시지 전송
        sendMessage: (message: any, callback?: (response: any) => void) => {
          this.handleExtensionMessage(message);
          if (callback) {
            callback({ success: true });
          }
        },
        // Listen to messages from background script / background script로부터 메시지 수신
        onMessage: {
          addListener: (callback: (message: any) => void) => {
            this.messageListeners.push(callback);
          },
          removeListener: (callback: (message: any) => void) => {
            const index = this.messageListeners.indexOf(callback);
            if (index > -1) {
              this.messageListeners.splice(index, 1);
            }
          },
        },
        // Get URL for extension resource / extension 리소스 URL 가져오기
        getURL: (path: string) => {
          return `devtools://devtools/bundled/panels/redux/extension/${path}`;
        },
      },
      devtools: {
        inspectedWindow: {
          // Evaluate script in inspected page / inspected page에서 스크립트 실행
          eval: (expression: string, callback?: (result: any, exceptionInfo?: any) => void) => {
            this.evaluateInInspectedPage(expression, callback);
          },
        },
      },
    };
  }

  /**
   * Handle messages from Redux DevTools Extension / Redux DevTools Extension으로부터 메시지 처리
   */
  private handleExtensionMessage(message: any): void {
    // Redux DevTools Extension의 메시지를 처리 / Redux DevTools Extension의 메시지를 처리
    // 여기서는 CDP 메시지로 변환하거나 필요한 작업 수행 / 여기서는 CDP 메시지로 변환하거나 필요한 작업 수행
    console.log('[ReduxExtensionBridge] Received message from extension:', message);
  }

  /**
   * Send message to Redux DevTools Extension iframe / Redux DevTools Extension iframe으로 메시지 전송
   */
  private sendToExtension(message: any): void {
    if (!this.iframeWindow || !this.messagePort) return;

    // MessagePort로 메시지 전송 / MessagePort로 메시지 전송
    this.messagePort.postMessage(message);

    // 또는 postMessage로 직접 전송 / 또는 postMessage로 직접 전송
    this.iframeWindow.postMessage(message, '*');
  }

  /**
   * Attach to target and listen for Redux CDP events / 타겟에 연결하고 Redux CDP 이벤트 리스닝
   */
  attachToTarget(target: SDK.Target.Target, connection: ProtocolClient.CDPConnection.CDPConnection): void {
    this.target = target;

    this.observer = {
      onEvent: (
        event: ProtocolClient.CDPConnection.CDPEvent<ProtocolClient.CDPConnection.Event>
      ): void => {
        // Redux CDP 이벤트를 Redux DevTools Extension 형식으로 변환 / Redux CDP 이벤트를 Redux DevTools Extension 형식으로 변환
        const method = event.method as string;
        if (method === 'Redux.init' ||
            method === 'Redux.actionDispatched' ||
            method === 'Redux.error') {
          this.convertCDPToExtensionMessage(event);
        }
      },
      onDisconnect: (_reason: string): void => {
        this.observer = null;
      },
    };

    connection.observe(this.observer);
  }

  /**
   * Convert CDP message to Extension message format / CDP 메시지를 Extension 메시지 형식으로 변환
   */
  private convertCDPToExtensionMessage(event: ProtocolClient.CDPConnection.CDPEvent<any>): void {
    const params = event.params as any;

    // Redux DevTools Extension이 기대하는 메시지 형식으로 변환 / Redux DevTools Extension이 기대하는 메시지 형식으로 변환
    const extensionMessage = {
      type: 'REDUX_MESSAGE',
      method: event.method,
      params: params,
      timestamp: Date.now(),
    };

    this.sendToExtension(extensionMessage);
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
  }
}

