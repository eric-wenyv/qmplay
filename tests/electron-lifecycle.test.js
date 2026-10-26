import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');

const profileRoot = path.resolve('/profiles');

async function desktop({ singleInstance = true, platform = process.platform } = {}) {
  const windows = [], trays = [], tasks = [];
  const lifecycle = { starts: 0, stops: 0, quits: 0, exited: false };
  const ipcMain = new EventEmitter();
  const app = Object.assign(new EventEmitter(), {
    setName() {}, getPath: () => profileRoot, setPath() {},
    setAppUserModelId(id) { lifecycle.appId = id; },
    requestSingleInstanceLock: () => singleInstance,
    whenReady: () => ({ then: action => tasks.push(Promise.resolve().then(action)) }),
    quit() {
      lifecycle.quits++;
      app.emit('before-quit');
      for (const window of windows) if (!window.destroyed) window.close();
      if (windows.some(window => !window.destroyed)) return;
      app.emit('will-quit');
      lifecycle.exited = true;
    },
  });
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.visible = false;
      this.minimized = false;
      this.destroyed = false;
      this.loads = 0;
      this.focuses = 0;
      this.restores = 0;
      this.webContents = Object.assign(new EventEmitter(), {
        mainFrame: {}, setWindowOpenHandler() {},
        session: { setPermissionRequestHandler() {} },
      });
      windows.push(this);
    }
    loadURL() { this.loads++; }
    show() { assert.equal(this.destroyed, false); this.visible = true; }
    hide() { this.visible = false; }
    focus() { this.focuses++; }
    minimize() { this.minimized = true; this.visible = false; }
    isMinimized() { return this.minimized; }
    restore() { this.minimized = false; this.restores++; }
    close() {
      const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      this.emit('close', event);
      if (!event.defaultPrevented) this.destroy();
    }
    destroy() {
      this.destroyed = true;
      this.visible = false;
      this.emit('closed');
      if (windows.every(window => window.destroyed)) app.emit('window-all-closed');
    }
  }
  class Tray extends EventEmitter {
    constructor(image) { super(); this.image = image; trays.push(this); }
    setToolTip(value) { this.tooltip = value; }
    setContextMenu(menu) { this.menu = menu; }
    destroy() { this.destroyed = true; }
  }
  const electron = {
    app, BrowserWindow: Window, Tray, ipcMain,
    protocol: { registerSchemesAsPrivileged() {}, handle() {} },
    Menu: { setApplicationMenu() {}, buildFromTemplate: items => items },
  };
  vm.runInNewContext(source, {
    require: id => {
      if (id === 'electron') return electron;
      if (id === 'node:fs') return {
        ...require(id), mkdirSync() {},
        existsSync: filename => filename.startsWith(profileRoot + path.sep) ? false : existsSync(filename),
      };
      if (id === './backend.cjs') return {
        createBackendController: () => ({
          async start() { lifecycle.starts++; return { origin: 'http://127.0.0.1:43210' }; },
          stop() { lifecycle.stops++; },
        }),
      };
      if (id === './artwork.cjs' || id === './api.cjs' || id === './auth-cookies.cjs') return {};
      return require(id);
    },
    __dirname: fileURLToPath(new URL('../electron/', import.meta.url)),
    process: { platform, env: {} },
  });
  await Promise.all(tasks);
  for (const window of windows) window.emit('ready-to-show');
  const send = (action, sender = windows[0]?.webContents, senderFrame = sender?.mainFrame) =>
    ipcMain.emit(`window:${action}`, { sender, senderFrame });
  return { app, windows, trays, lifecycle, send };
}

test('desktop creates a packaged tray icon with exactly the Show and Quit menu items', async () => {
  const { windows: [window], trays: [tray], lifecycle } = await desktop();
  assert.equal(existsSync(tray.image), true);
  assert.equal(tray.image, window.options.icon);
  assert.equal(tray.tooltip, 'qqmui');
  assert.deepEqual(Array.from(tray.menu, item => item.label), ['显示', '退出']);
  assert.equal(window.options.webPreferences.backgroundThrottling, false);
  assert.equal(window.visible, true);
  assert.equal(lifecycle.starts, 1);
});

test('Windows uses the installer app ID and keeps playback alive until tray Quit', async () => {
  const { windows: [window], trays: [tray], lifecycle } = await desktop({ platform: 'win32' });
  assert.equal(lifecycle.appId, 'app.qqmui');
  window.close();
  assert.equal(window.destroyed, false);
  assert.equal(lifecycle.stops, 0);
  tray.emit('click');
  assert.equal(window.visible, true);
  assert.equal(window.loads, 1);
  tray.menu[1].click();
  assert.equal(lifecycle.exited, true);
  assert.equal(lifecycle.stops, 1);
});

test('native close and the titlebar close button hide the existing renderer and keep the backend alive', async () => {
  const { windows: [window], lifecycle, send } = await desktop();
  window.close();
  assert.equal(window.visible, false);
  assert.equal(window.destroyed, false);
  window.show();
  send('close');
  assert.equal(window.visible, false);
  assert.equal(window.destroyed, false);
  assert.equal(window.loads, 1);
  assert.equal(lifecycle.stops, 0);
  assert.equal(lifecycle.quits, 0);
  assert.equal(lifecycle.exited, false);
});

test('tray click, Show, a second launch and activation restore the same window without reloading playback', async () => {
  const { app, windows, trays: [tray], lifecycle } = await desktop();
  const window = windows[0];
  for (const show of [
    () => tray.emit('click'), () => tray.menu[0].click(),
    () => app.emit('second-instance'), () => app.emit('activate'),
  ]) {
    window.minimize();
    window.close();
    const focuses = window.focuses;
    const restores = window.restores;
    show();
    assert.equal(window.visible, true);
    assert.equal(window.minimized, false);
    assert.equal(window.focuses, focuses + 1);
    assert.equal(window.restores, restores + 1);
    assert.equal(windows.length, 1);
    assert.equal(window.loads, 1);
  }
  assert.equal(lifecycle.starts, 1);
  assert.equal(lifecycle.stops, 0);
});

test('window controls retain their sender and main-frame restrictions', async () => {
  const { windows: [window], send, lifecycle } = await desktop();
  send('close', {});
  send('close', window.webContents, {});
  assert.equal(window.visible, true);
  send('minimize');
  assert.equal(window.isMinimized(), true);
  assert.equal(window.destroyed, false);
  assert.equal(lifecycle.stops, 0);
});

test('tray Quit destroys both visible and hidden windows, removes the tray and stops the backend', async () => {
  for (const hidden of [false, true]) {
    const { app, windows, trays: [tray], lifecycle } = await desktop();
    const window = windows[0];
    if (hidden) window.close();
    tray.menu[1].click();
    assert.equal(lifecycle.quits, 1);
    assert.equal(lifecycle.exited, true);
    assert.equal(lifecycle.stops, 1);
    assert.equal(window.destroyed, true);
    assert.equal(tray.destroyed, true);
    // Activation during shutdown must not recreate a window or revive playback.
    app.emit('activate');
    tray.emit('click');
    assert.equal(windows.length, 1);
  }
});

test('the tray keeps the process alive if all windows are destroyed and Show can create a replacement', async () => {
  const { windows, trays: [tray], lifecycle } = await desktop();
  windows[0].destroy();
  assert.equal(lifecycle.quits, 0);
  assert.equal(lifecycle.stops, 0);
  tray.menu[0].click();
  assert.equal(windows.length, 2);
  windows[1].emit('ready-to-show');
  assert.equal(windows[1].visible, true);
  tray.menu[1].click();
  assert.equal(lifecycle.exited, true);
  assert.equal(lifecycle.stops, 1);
});

test('a duplicate process exits without creating another backend, window or tray', async () => {
  const { windows, trays, lifecycle } = await desktop({ singleInstance: false });
  assert.equal(lifecycle.exited, true);
  assert.equal(windows.length, 0);
  assert.equal(trays.length, 0);
  assert.equal(lifecycle.starts, 0);
});
