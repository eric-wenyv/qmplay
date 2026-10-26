/** Data shared by the provider, application controllers and React views. */
export type Quality = "flac" | "320" | "128" | "m4a";
export type PlayOrder = "repeat" | "shuffle" | "repeatOne";
export interface Resource {
  id: string;
  name?: string;
  coverUrl?: string;
  avatarUrl?: string;
  group?: string;
  publishDate?: string;
}
export interface Track {
  id: string;
  title: string;
  duration?: number;
  artist?: string;
  artistId?: string;
  album?: string;
  albumId?: string;
  coverUrl?: string;
  mediaId?: string;
  songId?: number | null;
  songType?: number;
  qualities?: Quality[];
  vip?: boolean;
  art?: string;
}
export interface Artist extends Resource {
  name: string;
  followerCount: number | null;
  avatarUrl: string;
  initial?: string;
  color?: string;
}
export interface Album extends Resource {
  name: string;
  publishDate: string;
  coverUrl: string;
}
export interface RadioStation extends Resource {
  name: string;
  group: string;
  coverUrl: string;
}
export type SourceType = "radio" | "liked" | "artist" | "album";
export interface QueueSource {
  type: SourceType;
  resource?: Resource | null;
  page?: number;
  hasMore?: boolean;
}
export interface LyricLine {
  time: number;
  text: string;
}
export interface User {
  uin: string;
  nickname?: string;
  avatar?: string;
}
export interface AuthState {
  state:
    | "loadingQr"
    | "scanned"
    | "checking"
    | "waiting"
    | "ready"
    | "unavailable"
    | "expired"
    | "cancelled"
    | "loginError";
  message?: string;
  image?: string;
  user?: User;
}
export interface AuthStatus {
  authenticated: boolean;
  user?: User;
}
export interface LoginQr {
  id: string;
  image: string;
  expiresAt: number;
}
export interface LoginResult {
  state: string;
  user?: User;
}
export interface RequestOptions {
  signal?: AbortSignal;
  method?: string;
  body?: unknown;
}
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface Library {
  queueSource: QueueSource | null;
  artistHistory: Artist[];
  hasQueue: boolean;
  accountUin?: string;
  liked: Track[];
  queue: Track[];
  order: PlayOrder;
  mode: string;
  station: Resource;
  artist: Resource | null;
  currentId?: string;
  elapsed: number;
}
export type View = "player" | "search" | "albums" | "browse" | "liked" | "lyrics" | "queue";
export type NavigationMode = "home" | "radio" | "liked" | "artist" | "queue";
export interface AppSnapshot {
  playback: {
    queue: Track[];
    order: PlayOrder;

    current: Track | null;
    index: number;
    elapsed: number;
    playing: boolean;
    desiredPlaying: boolean;
    loading: boolean;
    source: QueueSource | null;
  };
  navigation: {
    view: View;

    mobile: boolean;
    mobilePage: View | null;
    mobileMode: NavigationMode;

    menuOpen: boolean;
    queueOpen: boolean;
  };
  auth: AuthState;
  catalog: {
    query: string;
    artists: Artist[];
    recentArtists: Artist[];
    artist: Artist | null;
    albums: Album[];
    stations: RadioStation[];
    hasMoreAlbums: boolean;
  };
  library: { liked: Track[]; busyIds: string[] };
  requests: {
    source: boolean;
    search: boolean;
    albums: boolean;
    lyrics: boolean;
    more: boolean;
  };
  lyrics: LyricLine[];
  notice: { message: string; retry: (() => unknown) | null } | null;
  announcement: string;
}
/** Explicit actions keep React and native event handlers independent of implementation. */
export interface MusicApplication {
  getSnapshot: () => AppSnapshot;
  subscribe: (listener: () => void) => () => void;
  start(): Promise<void>;
  stop(): void;
  savePreferences(): void;
  refreshFavorites(): Promise<void>;
  retryAuthentication(): Promise<void>;
  setMobile(mobile: boolean): void;
  setMenu(open: boolean): void;
  setView(view: View): void;
  returnToPlayer(): void;
  resumeMobilePage(): void;
  showSearch(): void;
  search(query: string): Promise<void>;
  cancelSearch(): void;
  loadFollowerCount(id: string): Promise<void>;
  showArtistAlbums(artist: Artist): Promise<void>;
  loadMoreAlbums(): Promise<void>;
  showRadio(): Promise<void>;
  showLiked(): void;
  switchSource(
    type: SourceType,
    resource?: Resource | null,
    options?: { autoplay?: boolean; trackId?: string },
  ): Promise<void>;
  togglePlay(): void;
  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): void;
  advance(direction: "next" | "previous", automatic?: boolean): Promise<void>;
  cycleOrder(): void;
  toggleLike(): Promise<void>;
  openQueue(): void;
  closeQueue(): void;
  selectTrack(index: number): Promise<void>;
  removeTrack(index: number): void;
  loadMore(options?: { quiet?: boolean }): Promise<boolean>;
  showLyrics(): void;
  dismissNotice(): void;
}
