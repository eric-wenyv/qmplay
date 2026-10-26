import { Context } from "koa";
import services from "../services";
import { withAccount } from "./auth";
import getPersonalRadioTracks from "../services/radio/getPersonalRadioTracks";

export default async (ctx: Context) => {
  const id = Number(ctx.query.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    ctx.status = 400;
    ctx.body = { response: "id must be a positive integer" };
    return;
  }
  // Keep the radio route and response shape shared with public channels.
  const response =
    id === 99
      ? {
          code: 0,
          radio: {
            code: 0,
            data: {
              track_list: await withAccount(ctx, (session) =>
                getPersonalRadioTracks(session.credential),
              ),
            },
          },
        }
      : await services.getRadioTracks(id, ctx.query.firstplay === "0" ? 0 : 1);
  ctx.body = { response };
};
