import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
async function desktop(jar, replies, profiles = []) {
  let handler;
  const identity = {};
  const directories = new Set(profiles.map((name) => `/profiles/${name}`));
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
    loadURL() {}
  }
  const electron = {
    app: {
      setName: (name) => { identity.name = name; },
      getPath: () => '/profiles',
      setPath: (key, value) => {
        assert(directories.has(value), 'Electron requires an existing profile directory');
        identity[key] = value;
      },
      whenReady: () => ({ then: (action) => tasks.push(action()) }),
      on() {},
    },
    protocol: {
      registerSchemesAsPrivileged() {},
      handle: (_scheme, action) => {
        handler = action;
      },
    },
    session: { defaultSession: { cookies } },
    Menu: { setApplicationMenu() {} },
    ipcMain: { on() {} },
    BrowserWindow: Window,
  };
  vm.runInNewContext(source, {
    require: (id) =>
      id === 'electron'
        ? electron
        : id === './artwork.cjs'
          ? {}
          : id === './auth-cookies.cjs'
            ? require('../electron/auth-cookies.cjs')
          : id === 'node:fs'
            ? {
                ...require(id),
                existsSync: (filename) => filename.startsWith('/profiles/')
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
    __dirname: new URL('../electron/', import.meta.url).pathname,
    process: { platform: 'linux' },
    URL,
    Response,
    Headers,
  });
  await Promise.all(tasks);
  return { handler, requests, identity };
}
test('qqmui reuses existing desktop profiles after the rename and prefers its own profile when present', async () => {
  for (const [profiles, expected] of [
    [[], 'qqmui'],
    [['Interlude'], 'Interlude'],
    [['间奏'], '间奏'],
    [['interlude-player'], 'interlude-player'],
    [['qqmui', 'Interlude'], 'qqmui'],
  ]) {
    const { identity } = await desktop(new Map(), [], profiles);
    assert.equal(identity.name, 'qqmui');
    assert.equal(identity.title, 'qqmui · qq music ui');
    assert.equal(identity.userData, `/profiles/${expected}`);
    assert.equal(identity.sessionData, identity.userData);
  }
});
test('desktop stores HttpOnly session cookies in the persistent jar, restores them after restart and never exposes them to the page', async () => {
  const jar = new Map();
  const first = await desktop(jar, [
    new Response('{"data":{"state":"authenticated"}}', {
      headers: {
        'Set-Cookie':
          `qq_music_session=opaque-token; Expires=${new Date(Date.now() + 2592000000).toUTCString()}; HttpOnly; SameSite=Strict; Path=/`,
      },
    }),
  ]);
  const response = await first.handler(
    new Request('interlude://app/api/auth/qr/check', { method: 'POST', body: '{"id":"qr"}' }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.has('set-cookie'), false);
  assert.equal(jar.get('qq_music_session').httpOnly, true);
  assert.equal(jar.get('qq_music_session').sameSite, 'strict');
  assert(jar.get('qq_music_session').expirationDate > Date.now() / 1000);
  const restored = await desktop(jar, [
    Response.json({ data: { authenticated: true } }),
    new Response('{}', {
      headers: { 'Set-Cookie': 'qq_music_session=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/' },
    }),
  ]);
  await restored.handler(new Request('interlude://app/api/auth/status'));
  assert.match(restored.requests[0][2].headers.Cookie, /qq_music_session=opaque-token/);
  assert.equal(restored.requests[0][2].headers.Origin, 'interlude://app');
  await restored.handler(
    new Request('interlude://app/api/auth/logout', { method: 'POST', body: '{}' }),
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
  const send = pathname => app.handler(new Request(`interlude://app/api${pathname}`, { method: 'POST', body: '{}' }));
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
