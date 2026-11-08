import type { QQMusicProvider } from "../api.js";

/** Controllers depend on capabilities rather than a particular HTTP implementation. */
export type ApplicationProvider = Pick<
  QQMusicProvider,
  | "getPlayback"
  | "getAuthStatus"
  | "createLoginQr"
  | "checkLoginQr"
  | "createQqLogin"
  | "getFavorites"
  | "setFavorite"
  | "searchArtists"
  | "searchTracks"
  | "getFollowerCount"
  | "getArtistAlbums"
  | "getArtistTrackPage"
  | "getAlbumTrackPage"
  | "getRadioTracks"
  | "getRecommendedTracks"
  | "getDailyRecommendedTracks"
  | "getLyrics"
> & { onAuthenticationRequired?: () => void };
