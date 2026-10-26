import { MusicCredential } from "../auth/session";
import { AuthError, musicRequest } from "../auth/upstream";

export default async (credential: MusicCredential) => {
  const data = await musicRequest(
    "music.radioProxy.MbTrackRadioSvr",
    "get_radio_track",
    { id: 99, num: 5, from: 0, scene: 0, song_ids: [] },
    credential,
  );
  if (!Array.isArray(data.tracks))
    throw new AuthError(502, "UPSTREAM_INVALID", "私人电台返回的歌曲数据不完整，请重试");
  return data.tracks;
};
