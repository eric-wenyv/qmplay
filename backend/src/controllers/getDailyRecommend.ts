import type { Context } from "koa";
import { withAccount } from "./auth";
import getDailyRecommendedTracks from "../services/radio/getDailyRecommendedTracks";

export default async (ctx: Context) => {
  const tracks = await withAccount(ctx, (session) => getDailyRecommendedTracks(session.credential));
  ctx.body = { data: { tracks } };
};
