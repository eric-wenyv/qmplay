import { MusicCredential } from './session';
import { AuthError, musicRequest } from './upstream';

export async function getFavorites(credential: MusicCredential, offset = 0, limit = 100) {
  const data = await musicRequest(
    'music.srfDissInfo.DissInfo',
    'CgiGetDiss',
    {
      disstid: 0,
      dirid: 201,
      tag: true,
      song_begin: offset,
      song_num: limit,
      userinfo: true,
      orderlist: true,
      onlysonglist: false,
    },
    credential,
  );
  if (!Array.isArray(data.songlist))
    throw new AuthError(502, 'UPSTREAM_INVALID', '收藏列表数据不完整，请重试');
  const total = Number(
    data.total_song_num ?? data.total_song ?? data.dirinfo?.songnum ?? data.dirinfo?.song_num,
  );
  const hasMore =
    data.hasmore !== undefined
      ? Boolean(Number(data.hasmore))
      : Number.isFinite(total)
        ? offset + data.songlist.length < total
        : data.songlist.length === limit;
  return {
    songs: data.songlist,
    total: Number.isFinite(total) ? total : null,
    hasMore,
    nextOffset: offset + data.songlist.length,
  };
}
export async function setFavorite(
  credential: MusicCredential,
  songId: number,
  songType: number,
  liked: boolean,
) {
  await musicRequest(
    'music.musicasset.PlaylistDetailWrite',
    liked ? 'AddSonglist' : 'DelSonglist',
    {
      dirId: 201,
      v_songInfo: [{ songId, songType }],
    },
    credential,
    true,
  );
  // A successful transport is insufficient: confirm the account actually changed before the UI reports success.
  let offset = 0;
  for (let page = 0; page < 200; page++) {
    const result = await getFavorites(credential, offset, 100);
    const found = result.songs.some(
      (song: any) =>
        Number(song.id ?? song.songid) === songId &&
        Number(song.type ?? song.songtype ?? 0) === songType,
    );
    if (found) {
      if (liked) return { liked: true };
      throw new AuthError(502, 'SYNC_NOT_CONFIRMED', 'QQ 音乐尚未确认取消收藏，请稍后重试');
    }
    if (!result.hasMore) {
      if (!liked) return { liked: false };
      throw new AuthError(502, 'SYNC_NOT_CONFIRMED', 'QQ 音乐尚未确认收藏，请稍后重试');
    }
    if (result.nextOffset <= offset) break;
    offset = result.nextOffset;
  }
  throw new AuthError(502, 'SYNC_NOT_CONFIRMED', '收藏列表未能完整校验，请稍后重试');
}
