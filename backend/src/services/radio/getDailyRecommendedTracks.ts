import type { MusicCredential } from "../auth/session";
import { AuthError, checkCodes, musicRequest } from "../auth/upstream";

const shanghaiDay = (time: number) =>
  new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
const invalid = () => new AuthError(502, "UPSTREAM_INVALID", "每日30首推荐数据不完整，请稍后重试");
const expired = () => new AuthError(502, "DAILY_EXPIRED", "每日30首尚未更新，请稍后重试");

export default async (credential: MusicCredential) => {
  const day = shanghaiDay(Date.now());
  const feed = await musicRequest(
    "music.recommend.RecommendFeed",
    "get_recommend_feed",
    { direction: 0, page: 1, v_cache: [], v_uniq: [], s_num: 0 },
    credential,
  );
  checkCodes(feed.retcode);
  if (!Array.isArray(feed.v_shelf)) throw invalid();
  const daily = [];
  // QQ identifies the daily playlist with subtype 510; other cards are unrelated recommendations.
  for (const shelf of feed.v_shelf) {
    if (!Array.isArray(shelf?.v_niche)) throw invalid();
    for (const niche of shelf.v_niche) {
      if (!Array.isArray(niche?.v_card)) throw invalid();
      for (const card of niche.v_card) if (card?.subtype === 510) daily.push(card);
    }
  }
  if (daily.length !== 1) throw invalid();
  const card = daily[0];
  const id = Number(card.id);
  if (!Number.isSafeInteger(id) || id <= 0 || String(id) !== String(card.id)) throw invalid();
  if (
    !Number.isSafeInteger(card.time) ||
    card.time < 1_000_000_000 ||
    card.time > 9_999_999_999 ||
    shanghaiDay(card.time * 1000) !== day
  )
    throw expired();
  const playlist = await musicRequest(
    "music.srfDissInfo.DissInfo",
    "CgiGetDiss",
    {
      disstid: id,
      dirid: 0,
      tag: true,
      song_begin: 0,
      song_num: 100,
      userinfo: true,
      orderlist: true,
      onlysonglist: false,
    },
    credential,
  );
  if (shanghaiDay(Date.now()) !== day) throw expired();
  if (!Array.isArray(playlist.songlist)) throw invalid();
  const total = playlist.total_song_num ?? playlist.total_song ?? playlist.dirinfo?.songnum;
  if (
    Number(playlist.hasmore) > 0 ||
    (total !== undefined && Number(total) !== playlist.songlist.length)
  )
    throw invalid();
  return playlist.songlist;
};
