import { Context } from "koa";
import { z } from "zod";
import { getSingerAlbums, getAlbumTracks } from "../services/singers/catalog";

const pagination = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(50),
};
const mid = z.string().regex(/^[\w-]{1,100}$/);
const singerQuery = z.object({ singermid: mid, ...pagination });
const albumQuery = z.object({ albummid: mid, ...pagination });

export async function singerAlbums(ctx: Context) {
  const query = singerQuery.safeParse(ctx.query);
  if (!query.success) ctx.throw(400);
  const { singermid, page, limit } = query.data;
  ctx.body = { response: await getSingerAlbums(singermid, page, limit) };
}
export async function albumTracks(ctx: Context) {
  const query = albumQuery.safeParse(ctx.query);
  if (!query.success) ctx.throw(400);
  const { albummid, page, limit } = query.data;
  ctx.body = { response: await getAlbumTracks(albummid, page, limit) };
}
