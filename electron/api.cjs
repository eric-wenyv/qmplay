const { validOrigin } = require('./backend.cjs');
// A stable cookie identity preserves the installed application's existing login.
// It is never used as the HTTP destination; every backend gets a private ephemeral port.
const API_ORIGIN = 'http://127.0.0.1:3200';
const GET_PATHS = new Set([
  '/getHotkey', '/getSingerList', '/getSingerStarNum', '/getSmartbox',
  '/getSingerHotsong', '/getRadioLists', '/getRadioTracks', '/getRecommend',
  '/getSingerAlbum', '/getAlbumTracks',
  '/getMusicPlay', '/getLyric', '/getSongInfo', '/auth/status', '/user/favorites',
]);
const POST_PATHS = new Set(['/auth/qr', '/auth/qr/check', '/auth/logout', '/user/favorites']);
function allowedApiRequest(pathname, method) {
  return ((method === 'GET' || method === 'HEAD') && GET_PATHS.has(pathname)) ||
    (method === 'POST' && POST_PATHS.has(pathname));
}
async function proxyApi(
  pathname,
  search,
  { method = 'GET', headers = {}, body, fetcher = globalThis.fetch, connection } = {},
) {
  if (!allowedApiRequest(pathname, method)) return new Response('Not found', { status: 404 });
  if (!connection || !validOrigin(connection.origin) || !/^[a-f0-9]{64}$/.test(connection.token || ''))
    throw new Error('内置音乐服务尚未就绪');
  if (search && (!search.startsWith('?') || /[\r\n#]/.test(search)))
    return new Response('Bad request', { status: 400 });
  const forwarded = new Headers();
  const source = new Headers(headers);
  for (const key of ['cookie', 'content-type', 'origin', 'sec-fetch-site'])
    if (source.has(key)) forwarded.set(key, source.get(key));
  forwarded.set('X-QQMUI-Token', connection.token);
  return fetcher(`${connection.origin}${pathname}${search}`, {
    method,
    headers: forwarded,
    body: method === 'POST' ? body : undefined,
    signal: AbortSignal.timeout(30000),
    redirect: 'error',
  });
}
module.exports = { API_ORIGIN, allowedApiRequest, proxyApi };
