const API_ORIGIN = 'http://127.0.0.1:3200';
const API_PATHS = new Set([
  '/getHotkey',
  '/getSingerList',
  '/getSingerStarNum',
  '/getSmartbox',
  '/getSingerHotsong',
  '/getRadioLists',
  '/getRadioTracks',
  '/getRecommend',
  '/getMusicPlay',
  '/getLyric',
  '/getSongInfo',
  '/auth/status',
  '/auth/qr',
  '/auth/qr/check',
  '/auth/logout',
  '/user/favorites',
]);
const POST_PATHS = new Set(['/auth/qr', '/auth/qr/check', '/auth/logout', '/user/favorites']);
function allowedApiRequest(pathname, method) {
  return (
    API_PATHS.has(pathname) &&
    (method === 'GET' || method === 'HEAD' || (method === 'POST' && POST_PATHS.has(pathname)))
  );
}
async function proxyApi(
  pathname,
  search,
  { method = 'GET', headers = {}, body, fetcher = globalThis.fetch } = {},
) {
  if (!allowedApiRequest(pathname, method)) return new Response('Not found', { status: 404 });
  const forwarded = new Headers();
  const source = new Headers(headers);
  for (const key of ['cookie', 'content-type', 'origin', 'sec-fetch-site'])
    if (source.has(key)) forwarded.set(key, source.get(key));
  return fetcher(`${API_ORIGIN}${pathname}${search}`, {
    method,
    headers: forwarded,
    body: method === 'POST' ? body : undefined,
    signal: AbortSignal.timeout(30000),
    redirect: 'error',
  });
}
module.exports = { API_ORIGIN, allowedApiRequest, proxyApi };
