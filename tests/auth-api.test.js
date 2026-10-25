import test from 'node:test';
import assert from 'node:assert/strict';
import { QQMusicProvider } from '../src/api.js';
import proxy from '../electron/api.cjs';
const reply = (value) => ({ ok: true, json: async () => ({ data: value }) });
test('collects every favorite page before returning a normalized snapshot with numeric song IDs', async () => {
  const urls = [];
  const provider = new QQMusicProvider({
    fetcher: async (url) => {
      urls.push(url);
      return reply(
        url.includes('offset=0')
          ? { songs: [{ mid: 'mid1', id: 11, title: 'one' }], hasMore: true, nextOffset: 1 }
          : { songs: [{ mid: 'mid2', id: 22, title: 'two' }], hasMore: false, nextOffset: 2 },
      );
    },
  });
  const tracks = await provider.getFavorites();
  assert.equal(tracks.length, 2);
  assert.equal(tracks[0].songId, 11);
  assert.match(urls[1], /offset=1/);
});
test('rejects partial/stalled pagination rather than replacing the cache with a partial list', async () => {
  const provider = new QQMusicProvider({
    fetcher: async () => reply({ songs: [], hasMore: true, nextOffset: 0 }),
  });
  await assert.rejects(provider.getFavorites(), /分页/);
});
test('401 triggers authentication recovery; server/network errors remain retryable and do not log out', async () => {
  let recoveries = 0;
  const provider = new QQMusicProvider({ fetcher: async () => ({ ok: false, status: 401 }) });
  provider.onAuthenticationRequired = () => recoveries++;
  assert.deepEqual(await provider.getAuthStatus(), { authenticated: false });
  assert.equal(recoveries, 0);
  await assert.rejects(provider.getFavorites(), (error) => error.code === 'AUTH_REQUIRED');
  assert.equal(recoveries, 1);
  provider.fetcher = async () => ({
    ok: false,
    status: 502,
    json: async () => ({ error: { message: 'upstream failed' } }),
  });
  await assert.rejects(provider.getFavorites(), /upstream failed/);
  assert.equal(recoveries, 1);
});
test('legacy favorites resolve their numeric song ID before writing and never send credentials to the renderer', async () => {
  const requests = [];
  const provider = new QQMusicProvider({
    fetcher: async (url, options) => {
      requests.push([url, options]);
      return url.includes('getSongInfo')
        ? reply({
            songinfo: { code: 0, data: { track_info: { mid: 'mid1', id: 11, title: 'one' } } },
          })
        : reply({ liked: true });
    },
  });
  const result = await provider.setFavorite({ id: 'mid1', title: 'one' }, true);
  assert.equal(result.songId, 11);
  assert.equal(requests[1][1].method, 'POST');
  assert.deepEqual(JSON.parse(requests[1][1].body), { songId: 11, songType: 0, liked: true });
  assert.equal(requests[1][1].credentials, 'same-origin');
});
test('private API proxy forwards only allowed methods and credential headers, without arbitrary targets', async () => {
  let captured;
  const response = await proxy.proxyApi('/auth/qr', '', {
    method: 'POST',
    connection: { origin: 'http://127.0.0.1:43210', token: 'a'.repeat(64) },
    body: '{}',
    headers: {
      Cookie: 'opaque=session',
      Origin: 'http://127.0.0.1:4173',
      'X-Untrusted': 'ignored',
      'X-QQMUI-Token': 'renderer-cannot-override-this',
    },
    fetcher: async (url, options) => {
      captured = [url, options];
      return new Response('{}');
    },
  });
  assert.equal(response.status, 200);
  assert.equal(captured[0], 'http://127.0.0.1:43210/auth/qr');
  assert.equal(captured[1].headers.get('X-QQMUI-Token'), 'a'.repeat(64));
  assert.equal(captured[1].headers.get('Cookie'), 'opaque=session');
  assert.equal(captured[1].headers.has('X-Untrusted'), false);
  assert.equal((await proxy.proxyApi('/user/setCookie', '', { method: 'POST' })).status, 404);
  assert.equal((await proxy.proxyApi('/getLyric', '', { method: 'POST' })).status, 404);
});

test('API proxy rejects absent or remote backend configuration and excludes read access to write-only auth routes', async () => {
  await assert.rejects(proxy.proxyApi('/auth/status', ''), /尚未就绪/);
  await assert.rejects(proxy.proxyApi('/auth/status', '', {
    connection: { origin: 'http://example.com:43210', token: 'a'.repeat(64) },
  }), /尚未就绪/);
  assert.equal((await proxy.proxyApi('/auth/qr', '', { method: 'GET' })).status, 404);
  assert.equal((await proxy.proxyApi('/auth/status', '#redirect', {
    connection: { origin: 'http://127.0.0.1:43210', token: 'a'.repeat(64) },
  })).status, 400);
});
