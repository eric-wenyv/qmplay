import { Context, Next } from 'koa';
import { createLoginQr, checkLoginQr, refreshCredential } from '../services/auth/login';
import { getFavorites, setFavorite } from '../services/auth/favorites';
import {
  MusicSession,
  newToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  sessions,
} from '../services/auth/session';
import { AuthError, musicRequest } from '../services/auth/upstream';
import { logger } from '../util/logger';

const CHALLENGE_COOKIE = 'qq_music_challenge';
const cookieOptions = {
  httpOnly: true,
  sameSite: 'strict' as const,
  overwrite: true,
  signed: false,
  path: '/',
};
const refreshes = new Map<string, Promise<void>>();
function body(ctx: Context): Record<string, unknown> {
  const value = (ctx.request as { body?: unknown }).body;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AuthError(400, 'INVALID_BODY', '请提供 JSON 请求体');
  return value as Record<string, unknown>;
}
export async function getSession(ctx: Context) {
  return sessions.get(ctx.cookies.get(SESSION_COOKIE, { signed: false }));
}
async function requireSession(ctx: Context) {
  const session = await getSession(ctx);
  if (!session) throw new AuthError(401, 'AUTH_REQUIRED', '请先登录 QQ 音乐');
  return session;
}
async function refreshSession(ctx: Context, session: MusicSession) {
  const token = ctx.cookies.get(SESSION_COOKIE, { signed: false });
  if (!token) throw new AuthError(401, 'AUTH_REQUIRED', '请先登录 QQ 音乐');
  let pending = refreshes.get(token);
  if (!pending) {
    pending = (async () => {
      session.credential = await refreshCredential(session.credential);
      // Logout must not resurrect a session when a refresh is already in flight.
      if (await sessions.get(token)) await sessions.save(token, session);
    })().finally(() => refreshes.delete(token));
    refreshes.set(token, pending);
  }
  await pending;
  const latest = await requireSession(ctx);
  session.credential = latest.credential;
}
export async function withAccount<T>(
  ctx: Context,
  operation: (session: MusicSession) => Promise<T>,
) {
  const session = await requireSession(ctx);
  try {
    return await operation(session);
  } catch (error) {
    if (!(error instanceof AuthError) || error.status !== 401) throw error;
    await refreshSession(ctx, session);
    return operation(session);
  }
}
export const authGuard = async (ctx: Context, next: Next) => {
  if (
    !ctx.path.startsWith('/auth/') &&
    ctx.path !== '/user/favorites' &&
    !ctx.path.startsWith('/getMusicPlay')
  )
    return next();
  ctx.set('Cache-Control', 'no-store');
  // Same-origin browser proxy and desktop protocol are the supported clients. Do not reflect arbitrary origins.
  const origin = ctx.get('Origin');
  let allowed = !origin || origin === 'interlude://app' || origin === ctx.origin;
  if (origin && !allowed) {
    try {
      const url = new URL(origin);
      allowed =
        ['http:', 'https:'].includes(url.protocol) &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    } catch {
      allowed = false;
    }
  }
  if (!allowed || ctx.get('Sec-Fetch-Site') === 'cross-site') {
    ctx.status = 403;
    ctx.body = { error: { code: 'ORIGIN_REJECTED', message: '不允许的请求来源' } };
    return;
  }
  if (ctx.method === 'POST' && !ctx.is('application/json')) {
    ctx.status = 415;
    ctx.body = { error: { code: 'JSON_REQUIRED', message: '请使用 application/json' } };
    return;
  }
  try {
    await next();
  } catch (error) {
    const known = error instanceof AuthError;
    ctx.status = known ? error.status : 503;
    if (ctx.status === 401) {
      const token = ctx.cookies.get(SESSION_COOKIE, { signed: false });
      if (token) await sessions.delete(token);
      ctx.cookies.set(SESSION_COOKIE, null, cookieOptions);
    }
    logger.warn('auth.request.failed', {
      path: ctx.path,
      status: ctx.status,
      code: known ? error.code : 'AUTH_UNAVAILABLE',
    });
    ctx.body = {
      error: {
        code: known ? error.code : 'AUTH_UNAVAILABLE',
        message: known ? error.message : '认证服务暂时不可用，请重试',
      },
    };
  }
};
export const authStatus = async (ctx: Context) => {
  if (!(await getSession(ctx))) {
    ctx.body = { data: { authenticated: false } };
    return;
  }
  const result = await withAccount(ctx, async (session) => {
    await getFavorites(session.credential, 0, 1);
    return { authenticated: true, user: { uin: String(session.credential.musicid) } };
  });
  ctx.body = { data: result };
};
export const loginQr = async (ctx: Context) => {
  const owner = ctx.cookies.get(CHALLENGE_COOKIE, { signed: false }) || newToken();
  const result = await createLoginQr(owner);
  ctx.cookies.set(CHALLENGE_COOKIE, owner, { ...cookieOptions, maxAge: 5 * 60 * 1000 });
  ctx.body = { data: result };
};
export const loginQrCheck = async (ctx: Context) => {
  const { id } = body(ctx);
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))
    throw new AuthError(400, 'INVALID_QR', '二维码标识无效');
  const result = await checkLoginQr(id, ctx.cookies.get(CHALLENGE_COOKIE, { signed: false }) || '');
  if (result.credential) {
    // Do not accept a mere QQ login: verify access to the music account before saving it.
    await getFavorites(result.credential, 0, 1);
    const token = newToken();
    await sessions.save(token, {
      credential: result.credential,
      expiresAt: Date.now() + SESSION_MAX_AGE,
    });
    const previous = ctx.cookies.get(SESSION_COOKIE, { signed: false });
    if (previous) await sessions.delete(previous);
    ctx.cookies.set(SESSION_COOKIE, token, {
      ...cookieOptions,
      maxAge: SESSION_MAX_AGE,
      secure: ctx.secure,
    });
    ctx.cookies.set(CHALLENGE_COOKIE, null, cookieOptions);
    ctx.body = { data: { state: result.state, user: { uin: String(result.credential.musicid) } } };
  } else ctx.body = { data: { state: result.state } };
};
export const logout = async (ctx: Context) => {
  const token = ctx.cookies.get(SESSION_COOKIE, { signed: false });
  if (token) await sessions.delete(token);
  ctx.cookies.set(SESSION_COOKIE, null, cookieOptions);
  ctx.cookies.set(CHALLENGE_COOKIE, null, cookieOptions);
  ctx.body = { data: { authenticated: false } };
};
export const listFavorites = async (ctx: Context) => {
  const offset = Number(ctx.query.offset ?? 0),
    limit = Number(ctx.query.limit ?? 100);
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 1000000 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new AuthError(400, 'INVALID_PAGE', 'offset 必须为非负整数，limit 必须为 1–100');
  ctx.body = {
    data: await withAccount(ctx, (session) => getFavorites(session.credential, offset, limit)),
  };
};
export const updateFavorite = async (ctx: Context) => {
  const { songId, songType = 0, liked } = body(ctx);
  if (
    typeof songId !== 'number' ||
    !Number.isSafeInteger(songId) ||
    songId <= 0 ||
    typeof songType !== 'number' ||
    !Number.isSafeInteger(songType) ||
    songType < 0 ||
    songType > 255 ||
    typeof liked !== 'boolean'
  )
    throw new AuthError(400, 'INVALID_SONG', '需要数字 songId、songType 和布尔 liked');
  ctx.body = {
    data: await withAccount(ctx, (session) =>
      setFavorite(session.credential, songId, songType, liked),
    ),
  };
};
export const accountMusicPlay = async (ctx: Context) => {
  const mids = String(ctx.query.songmid || ctx.params.songmid || '').split(',');
  const mediaId = String(ctx.query.mediaId || '');
  const formats: Record<string, [string, string]> = {
    m4a: ['C400', '.m4a'],
    '128': ['M500', '.mp3'],
    '320': ['M800', '.mp3'],
    flac: ['F000', '.flac'],
    ape: ['A000', '.ape'],
  };
  const format = formats[String(ctx.query.quality || '128')];
  if (
    !format ||
    mids.length > 100 ||
    mids.some((mid) => !/^[\w-]{1,100}$/.test(mid)) ||
    (mediaId && !/^[\w-]{1,100}$/.test(mediaId))
  )
    throw new AuthError(400, 'INVALID_SONG', '歌曲或音质参数无效');
  const result = await withAccount(ctx, (session) =>
    musicRequest(
      'vkey.GetVkeyServer',
      'CgiGetVkey',
      {
        filename: mids.map((mid) => `${format[0]}${mediaId || mid}${format[1]}`),
        guid: '1429839143',
        songmid: mids,
        songtype: mids.map(() => 0),
        uin: String(session.credential.musicid),
        loginflag: 1,
        platform: '20',
      },
      session.credential,
    ),
  );
  const domain =
    result.sip?.find((value: string) => !value.startsWith('http://ws')) || result.sip?.[0] || '';
  const playUrl = Object.fromEntries(
    (result.midurlinfo || []).map((item: any) => [
      item.songmid,
      {
        url: item.purl ? `${domain}${item.purl}` : '',
        error: item.purl ? false : '暂无播放链接',
      },
    ]),
  );
  ctx.body = { data: { playUrl } };
};
