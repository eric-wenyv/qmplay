import { timingSafeEqual } from 'node:crypto';
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import { authGuard } from './controllers/auth';
import { createRouter } from './routes/router';
import { logger } from './util/logger';

export { API_PATHS } from './routes/router';

export function createApp({ token = process.env.QQMUI_API_TOKEN || '' } = {}) {
  const app = new Koa();
  app.use(async (ctx, next) => {
    ctx.set('Cache-Control', 'no-store');
    if (token) {
      const supplied = Buffer.from(ctx.get('X-QQMUI-Token'));
      const expected = Buffer.from(token);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        ctx.status = 403;
        ctx.body = { error: { code: 'LOCAL_ACCESS_REJECTED', message: '不允许的本地服务请求' } };
        return;
      }
    }
    try {
      await next();
      // Legacy public services return Axios errors as bodies. Never serialize those.
      if (ctx.status >= 500) {
        const existing = (ctx.body as { error?: { code?: unknown; message?: unknown } } | undefined)?.error;
        const known = existing && typeof existing.code === 'string' &&
          typeof existing.message === 'string' &&
          Object.keys(existing).every((key) => key === 'code' || key === 'message');
        ctx.body = { error: known
          ? { code: existing.code, message: existing.message }
          : { code: 'UPSTREAM_UNAVAILABLE', message: 'QQ 音乐服务暂时不可用，请重试' } };
      }
    } catch (error) {
      const status = typeof (error as { status?: number })?.status === 'number'
        ? (error as { status: number }).status : 502;
      ctx.status = status >= 400 && status < 500 ? status : 502;
      logger.warn('api.request.failed', { path: ctx.path, status: ctx.status });
      ctx.body = { error: {
        code: ctx.status < 500 ? 'INVALID_REQUEST' : 'UPSTREAM_UNAVAILABLE',
        message: ctx.status < 500 ? '请求参数或格式无效' : 'QQ 音乐服务暂时不可用，请重试',
      } };
    }
  });
  app.use(bodyParser({ enableTypes: ['json'], jsonLimit: '64kb' }));
  app.use(authGuard);
  app.use(async (ctx, next) => {
    if (ctx.path === '/health' && (ctx.method === 'GET' || ctx.method === 'HEAD')) {
      ctx.body = { service: 'qqmui-api', version: 1 };
      return;
    }
    await next();
  });
  const router = createRouter();
  app.use(router.routes()).use(router.allowedMethods());
  // This is an app-owned local service, not the standalone API Explorer/server.
  app.silent = true;
  return app;
}

export default createApp;
