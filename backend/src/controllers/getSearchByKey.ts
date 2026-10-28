import { Context } from "koa";
import { z } from "zod";
import { getSearchByKey } from "../services/search/getSearchByKey";

const searchQuery = z.object({
  key: z.string().trim().min(1).max(200),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(50),
});

export default async function searchTracks(ctx: Context) {
  const query = searchQuery.safeParse(ctx.query);
  if (!query.success) ctx.throw(400);
  const { key, page, limit } = query.data;
  ctx.body = { response: await getSearchByKey(key, page, limit) };
}
