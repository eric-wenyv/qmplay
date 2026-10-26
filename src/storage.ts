import type { Artist, Library, QueueSource, Resource, StorageLike, Track } from "./contracts.js";

const preferenceKey = "qmplay-library-v2";
const legacyPreferenceKey = "interlude-library-v2";
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
function resource(value: unknown): Resource | null {
  const data = record(value);
  return typeof data.id === "string" ? (data as unknown as Resource) : null;
}
function readQueueSource(data: Record<string, unknown>): QueueSource | null {
  const value = Object.hasOwn(data, "queueSource")
    ? data.queueSource
    : {
        type: data.mode || "radio",
        resource: data.mode === "artist" ? data.artist : data.station,
      };
  if (!value) return null;
  const source = record(value),
    selected = resource(source.resource);
  if (source.type === "liked") return { type: "liked" };
  if ((source.type === "artist" || source.type === "album") && selected)
    return {
      type: source.type,
      resource: selected,
      page:
        typeof source.page === "number" && Number.isSafeInteger(source.page) && source.page > 0
          ? source.page
          : 1,
      ...(typeof source.hasMore === "boolean" && { hasMore: source.hasMore }),
    };
  return {
    type: "radio",
    resource:
      source.type === "radio" && selected && /^(new|\d+)$/.test(selected.id)
        ? selected
        : { id: "new", name: "每日新歌" },
  };
}
export function validTrack(value: unknown): value is Track {
  const track = record(value);
  return (
    typeof track.id === "string" &&
    /^[\w-]{1,100}$/.test(track.id) &&
    typeof track.title === "string"
  );
}
export function artistHistory(history: unknown = []): Artist[] {
  const seen = new Set<string>();
  const result: Artist[] = [];
  for (const value of Array.isArray(history) ? history : []) {
    const artist = record(value);
    if (
      typeof artist.id !== "string" ||
      !/^[\w-]{1,100}$/.test(artist.id) ||
      typeof artist.name !== "string" ||
      !artist.name.trim() ||
      seen.has(artist.id)
    )
      continue;
    seen.add(artist.id);
    result.push({
      id: artist.id,
      name: artist.name.slice(0, 200),
      avatarUrl: typeof artist.avatarUrl === "string" ? artist.avatarUrl.slice(0, 1000) : "",
      followerCount:
        typeof artist.followerCount === "number" &&
        Number.isSafeInteger(artist.followerCount) &&
        artist.followerCount >= 0
          ? artist.followerCount
          : null,
    });
    if (result.length === 10) break;
  }
  return result;
}
export function rememberArtist(history: Artist[], artist: Artist): Artist[] {
  return artistHistory([artist, ...history.filter((item) => item.id !== artist.id)]);
}
export function readLibrary(storage: StorageLike = globalThis.localStorage): Library {
  try {
    const data = record(
      JSON.parse(storage.getItem(preferenceKey) || storage.getItem(legacyPreferenceKey) || "{}"),
    );
    const station = resource(data.station),
      artist = resource(data.artist);
    return {
      queueSource: readQueueSource(data),
      artistHistory: artistHistory(data.artistHistory),
      hasQueue: Array.isArray(data.queue),
      accountUin: typeof data.accountUin === "string" ? data.accountUin : "",
      liked: Array.isArray(data.liked) ? data.liked.filter(validTrack).slice(0, 5000) : [],
      queue: Array.isArray(data.queue) ? data.queue.filter(validTrack) : [],
      order: data.order === "shuffle" || data.order === "repeatOne" ? data.order : "repeat",
      mode: data.mode === "artist" || data.mode === "liked" ? data.mode : "radio",
      station:
        station && /^(new|\d+)$/.test(station.id) ? station : { id: "new", name: "每日新歌" },
      artist,
      currentId: typeof data.currentId === "string" ? data.currentId : "",
      elapsed: Math.max(0, Number(data.elapsed) || 0),
    };
  } catch {
    return {
      queueSource: readQueueSource({}),
      artistHistory: [],
      hasQueue: false,
      liked: [],
      queue: [],
      order: "repeat",
      mode: "radio",
      station: { id: "new", name: "每日新歌" },
      artist: null,
      elapsed: 0,
    };
  }
}
export type LibraryWrite = Partial<Library> & {
  liked: Track[];
  queue: Track[];
  baseUrl?: unknown;
  quality?: unknown;
  volume?: unknown;
};
export function writeLibrary(
  data: LibraryWrite,
  storage: StorageLike = globalThis.localStorage,
): boolean {
  try {
    const { baseUrl: _baseUrl, quality: _quality, volume: _volume, ...library } = data;
    const clean = (track: Track & { url?: unknown; playbackUrl?: unknown }) => {
      const { url: _url, playbackUrl: _playbackUrl, ...value } = track;
      return value;
    };
    storage.setItem(
      preferenceKey,
      JSON.stringify({
        ...library,
        artistHistory: artistHistory(data.artistHistory),
        queue: data.queue.map(clean),
        liked: data.liked.map(clean),
      }),
    );
    return true;
  } catch {
    return false;
  }
}
