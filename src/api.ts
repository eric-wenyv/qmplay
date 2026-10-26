import type {
  Album,
  Artist,
  AuthStatus,
  LoginQr,
  LoginResult,
  LyricLine,
  Quality,
  RadioStation,
  RequestOptions,
  Track,
  User,
} from "./contracts.js";

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
const at = (value: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((current, key) => object(current)[key], value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const present = <T>(value: T | null): value is T => value !== null;
const errorCode = (value: unknown): string => String(at(value, "code") || "");
const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

export class MusicApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "MusicApiError";
  }
}
export function safeUrl(value: unknown): string {
  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      ? url.href.replace(/^http:/, "https:")
      : "";
  } catch {
    return "";
  }
}
export const playbackQualities: Array<{ id: Quality; sizes: string[] }> = [
  { id: "flac", sizes: ["size_flac"] },
  { id: "320", sizes: ["size_320mp3"] },
  { id: "128", sizes: ["size_128mp3"] },
  {
    id: "m4a",
    sizes: ["size_192aac", "size_96aac", "size_48aac", "size_24aac"],
  },
];
export function getTrackQualities(
  track: Track,
  supportedQualities: Quality[] = playbackQualities.map((item) => item.id),
): Quality[] {
  const advertised =
    Array.isArray(track.qualities) && track.qualities.length ? track.qualities : null;
  return playbackQualities
    .map((item) => item.id)
    .filter((id) => supportedQualities.includes(id) && (!advertised || advertised.includes(id)));
}
// Upstream JSON is decoded only at this boundary; application code receives typed records.
export function normalizeTrack(value: unknown): Track | null {
  const song = object(at(value, "musicData") || at(value, "songInfo") || value);
  const id = song.mid || song.songmid;
  if (!id) return null;
  const singers = list(song.singer).map(object),
    albumId = at(song, "album", "mid") || song.albummid;
  return {
    id: String(id),
    songId: Number(song.id ?? song.songid) || null,
    songType: Number(song.type ?? song.songtype) || 0,
    title: String(song.title || song.name || song.songname || "未命名歌曲"),
    artist:
      singers
        .map((singer) => singer.name || singer.title)
        .filter(Boolean)
        .join(" / ") || "未知歌手",
    artistId: String(singers[0]?.mid || ""),
    album: String(at(song, "album", "name") || song.albumname || ""),
    albumId: String(albumId || ""),
    duration: Math.max(0, Number(song.interval) || 0),
    mediaId: String(at(song, "file", "media_mid") || song.strMediaMid || id),
    coverUrl: albumId
      ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${encodeURIComponent(String(albumId))}.jpg`
      : "",
    qualities: playbackQualities
      .filter((item) => item.sizes.some((size) => Number(at(song, "file", size)) > 0))
      .map((item) => item.id),
    vip: !!at(song, "pay", "pay_play"),
    art: "original",
  };
}
export function normalizeTracks(value: unknown): Track[] {
  return [
    ...new Map(
      list(value)
        .map(normalizeTrack)
        .filter(present)
        .map((track) => [track.id, track]),
    ).values(),
  ];
}
export function normalizeArtist(value: unknown): Artist | null {
  const singer = object(value),
    id = singer.singer_mid || singer.mid;
  if (!id) return null;
  const name = String(singer.singer_name || singer.name || "未知歌手");
  return {
    id: String(id),
    name,
    initial: name[0],
    color: "green",
    followerCount: null,
    avatarUrl:
      safeUrl(singer.singer_pic || singer.pic) ||
      `https://y.gtimg.cn/music/photo_new/T001R150x150M000${encodeURIComponent(String(id))}.jpg`,
  };
}
export function normalizeAlbum(value: unknown): Album | null {
  const album = object(value),
    id = album.albumMid || album.album_mid || album.mid;
  if (!id) return null;
  return {
    id: String(id),
    name: String(album.albumName || album.album_name || album.name || ""),
    publishDate: String(album.publishDate || album.pub_time || ""),
    coverUrl: `https://y.gtimg.cn/music/photo_new/T002R500x500M000${encodeURIComponent(String(id))}.jpg`,
  };
}
function catalogPage<T extends { id: string }>(
  values: unknown,
  total: unknown,
  page: number,
  limit: number,
  normalize: (value: unknown) => T | null,
): { items: T[]; hasMore: boolean } {
  if (!Array.isArray(values)) throw new Error("音乐列表数据不完整，请重试");
  const count = Number(total);
  return {
    items: [
      ...new Map(
        values
          .map(normalize)
          .filter(present)
          .map((item) => [item.id, item]),
      ).values(),
    ],
    hasMore:
      values.length > 0 &&
      (total != null && Number.isSafeInteger(count) && count >= 0
        ? (page - 1) * limit + values.length < count
        : values.length >= limit),
  };
}
export function normalizeBaseUrl(value: unknown): string {
  if (!String(value || "").trim()) return "";
  const url = new URL(String(value).trim());
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("请输入有效的 HTTP 或 HTTPS 服务地址");
  return url.href.replace(/\/$/, "");
}
export function artworkUrl(value: unknown): string {
  const url = safeUrl(value);
  return url ? `./art?url=${encodeURIComponent(url)}` : "./assets/coast.jpg";
}
export interface ProviderOptions {
  baseUrl?: string;
  fetcher?: typeof globalThis.fetch;
  timeout?: number;
  supportedQualities?: Quality[];
}
export class QQMusicProvider {
  readonly baseUrl: string;
  readonly fetcher: typeof globalThis.fetch;
  readonly timeout: number;
  readonly supportedQualities: Quality[];
  readonly followerCache = new Map<string, number>();
  onAuthenticationRequired?: () => void;
  constructor({
    baseUrl = "",
    fetcher = globalThis.fetch,
    timeout = 15000,
    supportedQualities = playbackQualities.map((item) => item.id),
  }: ProviderOptions = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetcher = fetcher.bind(globalThis);
    this.timeout = timeout;
    this.supportedQualities = supportedQualities;
  }
  async request(
    path: string,
    params: Record<string, string | number | boolean | undefined> = {},
    { signal, method = "GET", body: requestBody }: RequestOptions = {},
  ): Promise<JsonObject> {
    const protocol = globalThis.location?.protocol;
    const base =
      this.baseUrl ||
      (["qmplay:", "interlude:"].includes(protocol) ? `${protocol}//app/api` : "/api");
    const query = new URLSearchParams(
      Object.entries(params)
        .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
        .map(([key, value]) => [key, String(value)]),
    );
    const timeout = AbortSignal.timeout(this.timeout);
    let result: unknown;
    try {
      const response = await this.fetcher(`${base}${path}?${query}`, {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        method,
        credentials: "same-origin",
        ...(requestBody !== undefined
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(requestBody),
            }
          : {}),
      });
      if (response.status === 401) {
        if (!path.startsWith("/auth/")) this.onAuthenticationRequired?.();
        throw new MusicApiError("登录已过期，请重新登录", "AUTH_REQUIRED");
      }
      if (!response.ok) {
        let detail: JsonObject = {};
        try {
          detail = object(at(await response.json(), "error"));
        } catch {
          /* Fall back to the HTTP status. */
        }
        throw new MusicApiError(
          String(
            detail.message ||
              (response.status === 502
                ? "内置音乐服务暂时无法连接，请重试或重新打开应用"
                : `音乐服务请求失败（${response.status}）`),
          ),
          typeof detail.code === "string" ? detail.code : undefined,
        );
      }
      try {
        result = await response.json();
      } catch {
        throw new Error("内置音乐服务返回了无效数据，请重试");
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      if (timeout.aborted) throw new Error("音乐服务响应超时，请重试");
      if (error instanceof TypeError)
        throw new Error("内置音乐服务暂时无法连接，请重试或重新打开应用");
      throw error;
    }
    const envelope = object(result),
      body = object(envelope.response ?? envelope.data ?? result);
    if (envelope.error || (body.code !== undefined && ![0, 200].includes(Number(body.code))))
      throw new Error("QQ 音乐暂时无法提供数据，请稍后重试");
    return body;
  }
  async getAuthStatus(): Promise<AuthStatus> {
    try {
      const result = await this.request("/auth/status");
      return {
        authenticated: result.authenticated === true,
        ...(result.user ? { user: this.user(result.user) } : {}),
      };
    } catch (error) {
      if (errorCode(error) === "AUTH_REQUIRED") return { authenticated: false };
      throw error;
    }
  }
  private user(value: unknown): User {
    const user = object(value);
    if (typeof user.uin !== "string" || !/^\d+$/.test(user.uin))
      throw new Error("登录账号数据不完整，请重试");
    return {
      uin: user.uin,
      ...(typeof user.nickname === "string" && { nickname: user.nickname }),
      ...(typeof user.avatar === "string" && { avatar: user.avatar }),
    };
  }
  async createLoginQr(): Promise<LoginQr> {
    const value = await this.request("/auth/qr", {}, { method: "POST", body: {} });
    if (
      typeof value.id !== "string" ||
      typeof value.image !== "string" ||
      typeof value.expiresAt !== "number"
    )
      throw new Error("登录二维码数据不完整，请重试");
    return { id: value.id, image: value.image, expiresAt: value.expiresAt };
  }
  async checkLoginQr(id: string): Promise<LoginResult> {
    const value = await this.request("/auth/qr/check", {}, { method: "POST", body: { id } });
    return {
      state: String(value.state || ""),
      ...(value.user ? { user: this.user(value.user) } : {}),
    };
  }
  logout(): Promise<JsonObject> {
    return this.request("/auth/logout", {}, { method: "POST", body: {} });
  }
  async getFavorites(): Promise<Track[]> {
    const songs: unknown[] = [];
    let offset = 0;
    for (let page = 0; page < 2000; page++) {
      const result = await this.request("/user/favorites", {
        offset,
        limit: 100,
      });
      if (!Array.isArray(result.songs) || typeof result.hasMore !== "boolean")
        throw new Error("收藏列表数据不完整，请重试");
      songs.push(...result.songs);
      if (!result.hasMore) return normalizeTracks(songs);
      if (
        typeof result.nextOffset !== "number" ||
        !Number.isSafeInteger(result.nextOffset) ||
        result.nextOffset <= offset
      )
        throw new Error("收藏列表分页未前进，请重试");
      offset = result.nextOffset;
    }
    throw new Error("收藏列表过大，未能完成同步");
  }
  async setFavorite(track: Track, liked: boolean): Promise<Track> {
    let songId = track.songId,
      songType = track.songType || 0;
    if (!isPositiveInteger(songId)) {
      const result = await this.request("/getSongInfo", { songmid: track.id });
      if (at(result, "songinfo", "code")) throw new Error("无法获取歌曲资料，请重试");
      const song = normalizeTrack(at(result, "songinfo", "data", "track_info"));
      if (!song || song.id !== track.id || !isPositiveInteger(song.songId))
        throw new Error("无法确认这首歌的收藏编号");
      songId = song.songId;
      songType = song.songType || 0;
    }
    const result = await this.request(
      "/user/favorites",
      {},
      { method: "POST", body: { songId, songType, liked } },
    );
    if (result.liked !== liked) throw new Error("QQ 音乐未确认收藏更改，请重试");
    return { ...track, songId, songType };
  }
  async searchArtists(query: string, options?: RequestOptions): Promise<Artist[]> {
    const term = query.trim();
    if (!term) return [];
    const body = await this.request("/getSmartbox", { key: term }, options);
    return list(at(body, "data", "singer", "itemlist"))
      .map(normalizeArtist)
      .filter(present);
  }
  async getFollowerCount(id: string, options?: RequestOptions): Promise<number | null> {
    const cached = this.followerCache.get(id);
    if (cached !== undefined) return cached;
    const body = await this.request("/getSingerStarNum", { singermid: id }, options),
      value = Number(body.num);
    const count = Number.isSafeInteger(value) && value >= 0 ? value : null;
    if (count !== null) this.followerCache.set(id, count);
    return count;
  }
  async getArtistTrackPage(
    id: string,
    page = 1,
    options?: RequestOptions,
  ): Promise<{ tracks: Track[]; hasMore: boolean }> {
    const body = await this.request(
      "/getSingerHotsong",
      { singermid: id, limit: 50, page },
      options,
    );
    if (at(body, "singer", "code")) throw new Error("暂时无法获取这位歌手的歌曲");
    const result = catalogPage(
      at(body, "singer", "data", "songlist"),
      at(body, "singer", "data", "total_song"),
      page,
      50,
      normalizeTrack,
    );
    return { tracks: result.items, hasMore: result.hasMore };
  }
  async getArtistTracks(id: string, page = 1, options?: RequestOptions): Promise<Track[]> {
    return (await this.getArtistTrackPage(id, page, options)).tracks;
  }
  async getArtistAlbums(
    id: string,
    page = 1,
    options?: RequestOptions,
  ): Promise<{ albums: Album[]; hasMore: boolean }> {
    const body = await this.request("/getSingerAlbum", { singermid: id, page, limit: 20 }, options);
    if (at(body, "singer", "code")) throw new Error("暂时无法获取这位歌手的专辑");
    const result = catalogPage(
      at(body, "singer", "data", "albumList"),
      at(body, "singer", "data", "total"),
      page,
      20,
      normalizeAlbum,
    );
    return { albums: result.items, hasMore: result.hasMore };
  }
  async getAlbumTrackPage(
    id: string,
    page = 1,
    options?: RequestOptions,
  ): Promise<{ tracks: Track[]; hasMore: boolean }> {
    const body = await this.request("/getAlbumTracks", { albummid: id, page, limit: 50 }, options);
    if (at(body, "album", "code")) throw new Error("暂时无法获取这张专辑的歌曲");
    const result = catalogPage(
      at(body, "album", "data", "songList"),
      at(body, "album", "data", "totalNum"),
      page,
      50,
      normalizeTrack,
    );
    return { tracks: result.items, hasMore: result.hasMore };
  }
  async getRadioStations(): Promise<RadioStation[]> {
    const body = await this.request("/getRadioLists");
    return list(at(body, "data", "data", "groupList") || at(body, "data", "groupList"))
      .flatMap((value) => {
        const group = object(value);
        return list(group.radioList).map((value) => {
          const radio = object(value);
          return {
            id: String(radio.radioId),
            name: String(radio.radioName),
            group: String(group.name),
            coverUrl: safeUrl(radio.radioImg),
          };
        });
      })
      .filter((station) => station.id !== "99");
  }
  async getRadioTracks(id = "199", firstplay = 1, options?: RequestOptions): Promise<Track[]> {
    const body = await this.request("/getRadioTracks", { id, firstplay }, options);
    if (at(body, "radio", "code") || at(body, "req_0", "code"))
      throw new Error("电台暂时无法提供歌曲，请换一个频道");
    const tracks = at(body.radio || body.req_0, "data", "track_list");
    if (!Array.isArray(tracks)) throw new Error("电台歌曲数据不完整，请重试");
    return normalizeTracks(tracks);
  }
  async getRecommendedTracks(options?: RequestOptions): Promise<Track[]> {
    const body = await this.request("/getRecommend", {}, options);
    return normalizeTracks(at(body, "new_song", "data", "songlist"));
  }
  async getPlayback(track: Track, { signal }: RequestOptions = {}): Promise<string> {
    for (const quality of getTrackQualities(track, this.supportedQualities)) {
      signal?.throwIfAborted();
      const body = await this.request(
        "/getMusicPlay",
        { songmid: track.id, mediaId: track.mediaId, quality },
        { signal },
      );
      const url = safeUrl(at(body, "playUrl", track.id, "url"));
      if (url) return url;
    }
    throw new Error("这首歌暂无播放权限或链接，请切换歌曲；付费歌曲需要服务端配置有效账号");
  }
  async getLyrics(id: string, options?: RequestOptions): Promise<LyricLine[]> {
    const body = await this.request("/getLyric", { songmid: id, isFormat: false }, options);
    return parseLyrics(body.lyric || "");
  }
  async checkConnection(): Promise<boolean> {
    const body = await this.request("/getHotkey");
    if (!body || typeof body !== "object") throw new Error("这不是可用的 QQ Music API 服务");
    return true;
  }
}
export function parseLyrics(text: unknown): LyricLine[] {
  if (typeof text !== "string") return [];
  const offset = Number(text.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0) / 1000,
    result: LyricLine[] = [];
  for (const line of text.split(/\r?\n/)) {
    const matches = [...line.matchAll(/\[(\d+):(\d{2})(?:\.(\d{1,3}))?\]/g)],
      content = line.replace(/\[[^\]]*\]/g, "").trim();
    if (!content) continue;
    for (const match of matches)
      result.push({
        time: Math.max(
          0,
          Number(match[1]) * 60 + Number(match[2]) + Number(`0.${match[3] || 0}`) - offset,
        ),
        text: content,
      });
  }
  return result.sort((a, b) => a.time - b.time);
}
