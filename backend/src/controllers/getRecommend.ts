import type { Context } from 'koa';
import services from '../services';

// qqmui only consumes new_song; avoid requesting unused playlists, charts or albums.
export default async (ctx: Context) => {
  const data = {
    comm: { ct: 24 },
    new_song: {
      module: 'newsong.NewSongServer',
      method: 'get_new_song_info',
      param: { type: 5 },
    },
  };
  const { data: response } = await services.UCommon({
    method: 'get',
    params: { format: 'json', data: JSON.stringify(data) },
  });
  ctx.body = { response };
};
