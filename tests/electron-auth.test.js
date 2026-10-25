import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
async function desktop(jar, replies) {
  let handler;
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
    constructor() {
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
    app: { setName() {}, whenReady: () => ({ then: (action) => tasks.push(action()) }), on() {} },
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
  return { handler, requests };
}
test('desktop stores HttpOnly session cookies in the persistent jar, restores them after restart and never exposes them to the page', async () => {
  const jar = new Map();
  const first = await desktop(jar, [
    new Response('{"data":{"state":"authenticated"}}', {
      headers: {
        'Set-Cookie':
          'qq_music_session=opaque-token; Max-Age=2592000; HttpOnly; SameSite=Strict; Path=/',
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
