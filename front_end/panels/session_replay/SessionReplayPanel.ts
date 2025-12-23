// Copyright 2025 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as UI from '../../ui/legacy/legacy.js';

let sessionReplayPanelInstance: SessionReplayPanel;

export class SessionReplayPanel extends UI.Panel.Panel {
  constructor() {
    super('session-replay');
    this.render();
  }

  private render(): void {
    const container = document.createElement('div');
    container.className = 'session-replay-panel';
    this.contentElement.appendChild(container);
  }

  static instance(opts: {forceNew: boolean|null} = {forceNew: null}): SessionReplayPanel {
    const {forceNew} = opts;
    if (!sessionReplayPanelInstance || forceNew) {
      sessionReplayPanelInstance = new SessionReplayPanel();
    }
    return sessionReplayPanelInstance;
  }
}

