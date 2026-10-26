import type { QQMusicProvider } from "../api.js";

/** Controllers depend on capabilities rather than a particular HTTP implementation. */
export type ApplicationProvider = Pick<
  QQMusicProvider,
  | "getPlayback"
  | "getAuthStatus"
  | "createLoginQr"
  | "checkLoginQr"
  | "getFavorites"
  | "setFavorite"
  | "searchArtists"
  | "getFollowerCount"
  | "getArtistAlbums"
  | "getArtistTrackPage"
  | "getAlbumTrackPage"
  | "getRadioStations"
  | "getRadioTracks"
  | "getRecommendedTracks"
  | "getLyrics"
> & { onAuthenticationRequired?: () => void };
