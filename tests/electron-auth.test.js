import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
const profileRoot = path.resolve('/profiles');
async function desktop(jar, replies, profiles = []) {
  let handler;
  const identity = {};
  const directories = new Set(profiles.map((name) => path.join(profileRoot, name)));
  const requests = [],
    tasks = [];
  const cookies = {
    get: async () => [...jar.values()],
    set: async (value) => {
      jar.set(value.name, value);
    },
    remove: async (_url, name) => {
      jar.delete(name);
    },
    flushStore: async () => {},
  };
  class Window {
    constructor(options) {
      identity.title = options.title;
      this.webContents = {
        setWindowOpenHandler() {},
        on() {},
        session: { setPermissionRequestHandler() {} },
      };
    }
    once() {}
    on() {}
    loadURL(url) { identity.url = url; }
  }
  const electron = {
    app: {
      requestSingleInstanceLock: () => true,
      setName: (name) => { identity.name = name; },
      getPath: () => profileRoot,
      setAppUserModelId() {},
      setPath: (key, value) => {
        assert(directories.has(value), 'Electron requires an existing profile directory');
        identity[key] = value;
      },
      whenReady: () => ({ then: (action) => tasks.push(action()) }),
      on() {},
    },
    protocol: {
      registerSchemesAsPrivileged(schemes) { identity.scheme = schemes[0].scheme; },
      handle: (scheme, action) => {
        assert.equal(scheme, identity.scheme);
        handler = action;
      },
    },
    session: { defaultSession: { cookies } },
    Menu: { setApplicationMenu() {}, buildFromTemplate: (items) => items },
    Tray: class { setToolTip() {} setContextMenu() {} on() {} },
    ipcMain: { on() {} },
    BrowserWindow: Window,
  };
  vm.runInNewContext(source, {
    require: (id) =>
      id === 'electron'
        ? electron
        : id === './artwork.cjs'
          ? {}
          : id === './backend.cjs'
            ? { createBackendController: () => ({ start: async () => ({ origin: 'http://127.0.0.1:43210', token: 'a'.repeat(64) }), stop() {} }) }
          : id === './auth-cookies.cjs'
            ? require('../electron/auth-cookies.cjs')
          : id === 'node:fs'
            ? {
                ...require(id),
                existsSync: (filename) => filename.startsWith(profileRoot + path.sep)
                  ? directories.has(filename)
                  : require(id).existsSync(filename),
                mkdirSync: (directory, options) => {
                  assert.equal(options.recursive, true);
                  directories.add(directory);
                },
              }
          : id === './api.cjs'
            ? {
                API_ORIGIN: 'http://127.0.0.1:3200',
                proxyApi: async (...args) => {
                  requests.push(args);
                  return replies.shift();
                },
              }
            : require(id),
    __dirname: fileURLToPath(new URL('../electron/', import.meta.url)),
    process: { platform: process.platform, env: {} },
    URL,
    Response,
    Headers,
  });
  await Promise.all(tasks);
  return { handler, requests, identity };
}
test('qmplay reuses existing desktop profiles after the rename and prefers its own profile when present', async () => {
  for (const [profiles, expected] of [
    [[], 'qmplay'],
    [['qqmui'], 'qqmui'],
    [['Interlude'], 'Interlude'],
    [['间奏'], '间奏'],
    [['interlude-player'], 'interlude-player'],
    [['qmplay', 'Interlude'], 'qmplay'],
    [['qmplay', 'qqmui'], 'qmplay'],
    [['qqmui', 'Interlude'], 'qqmui'],
  ]) {
    const { identity, handler, requests } = await desktop(new Map(), [Response.json({})], profiles);
    assert.equal(identity.name, 'qmplay');
    assert.equal(identity.title, 'qmplay · QQ 音乐播放器');
    assert.equal(identity.userData, path.join(profileRoot, expected));
    assert.equal(identity.sessionData, identity.userData);
    assert.equal(identity.scheme, expected === 'qmplay' ? 'qmplay' : 'interlude');
    assert.equal(identity.url, `${identity.scheme}://app/index.html`);
    await handler(new Request(`${identity.scheme}://app/api/auth/status`));
    assert.equal(requests[0][2].headers.Origin, `${identity.scheme}://app`);
  }
});
test('desktop stores HttpOnly session cookies in the persistent jar, restores them after restart and never exposes them to the page', async () => {
  const jar = new Map();
  const first = await desktop(jar, [
    new Response('{"data":{"state":"authenticated"}}', {
      headers: {
        'X-QMPLAY-Token': 'internal-token-never-exposed',
        'Set-Cookie':
          `qq_music_session=opaque-token; Expires=${new Date(Date.now() + 2592000000).toUTCString()}; HttpOnly; SameSite=Strict; Path=/`,
      },
    }),
  ]);
  const response = await first.handler(
    new Request('qmplay://app/api/auth/qr/check', { method: 'POST', body: '{"id":"qr"}' }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.has('set-cookie'), false);
  assert.equal(response.headers.has('x-qmplay-token'), false);
  assert.equal(jar.get('qq_music_session').httpOnly, true);
  assert.equal(jar.get('qq_music_session').sameSite, 'strict');
  assert(jar.get('qq_music_session').expirationDate > Date.now() / 1000);
  const restored = await desktop(jar, [
    Response.json({ data: { authenticated: true } }),
    new Response('{}', {
      headers: { 'Set-Cookie': 'qq_music_session=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/' },
    }),
  ]);
  await restored.handler(new Request('qmplay://app/api/auth/status'));
  assert.match(restored.requests[0][2].headers.Cookie, /qq_music_session=opaque-token/);
  assert.equal(restored.requests[0][2].headers.Origin, 'qmplay://app');
  assert.equal(restored.requests[0][2].connection.origin, 'http://127.0.0.1:43210');
  assert.equal(restored.requests[0][2].connection.token.length, 64);
  await restored.handler(
    new Request('qmplay://app/api/auth/logout', { method: 'POST', body: '{}' }),
  );
  assert.equal(jar.has('qq_music_session'), false);
});

test('desktop keeps the QR owner through multiple polls and stores the confirmed login using Koa Expires cookies', async () => {
  const jar = new Map();
  const expires = new Date(Date.now() + 300000).toUTCString();
  const sessionExpires = new Date(Date.now() + 2592000000).toUTCString();
  const replies = [
    Response.json({ data: { id: 'qr', image: 'data:image/png;base64,image', expiresAt: Date.now() + 120000 } }, { headers: {
      'Set-Cookie': `qq_music_challenge=qr-owner; path=/; expires=${expires}; httponly; samesite=strict`,
    } }),
    Response.json({ data: { state: 'waiting' } }),
    Response.json({ data: { state: 'scanned' } }),
    Response.json({ data: { state: 'authenticated', user: { uin: '12345' } } }, { headers: [
      ['Set-Cookie', `qq_music_session=opaque-token; path=/; expires=${sessionExpires}; httponly; samesite=strict`],
      ['Set-Cookie', 'qq_music_challenge=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; httponly; samesite=strict'],
    ] }),
  ];
  const app = await desktop(jar, replies);
  const send = pathname => app.handler(new Request(`qmplay://app/api${pathname}`, { method: 'POST', body: '{}' }));
  const created = await send('/auth/qr');
  assert.equal((await created.json()).data.id, 'qr');
  assert.equal(jar.get('qq_music_challenge').expirationDate, Date.parse(expires) / 1000);
  for (const state of ['waiting', 'scanned', 'authenticated']) {
    const result = await send('/auth/qr/check');
    assert.equal((await result.json()).data.state, state);
    assert.match(app.requests.at(-1)[2].headers.Cookie, /qq_music_challenge=qr-owner/);
  }
  assert.equal(jar.has('qq_music_challenge'), false);
  assert.equal(jar.get('qq_music_session').expirationDate, Date.parse(sessionExpires) / 1000);
});
