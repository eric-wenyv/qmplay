import { Context } from 'koa';
import services from '../services';

export default async (ctx: Context) => {
  const id = Number(ctx.query.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    ctx.status = 400;
    ctx.body = { response: 'id must be a positive integer' };
    return;
  }
  const response = await services.getRadioTracks(id, ctx.query.firstplay === '0' ? 0 : 1);
  ctx.body = { response };
};
