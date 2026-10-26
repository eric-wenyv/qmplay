import type { AppSnapshot } from "../contracts.js";

/** Controllers replace changed records and collections; snapshots share all unchanged data. */
export class ApplicationStore {
  private listeners = new Set<() => void>();
  private records = new WeakMap<object, object>();
  private snapshot: AppSnapshot;
  constructor(readonly state: AppSnapshot) {
    this.snapshot = this.copy();
  }
  getSnapshot = (): AppSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  publish(): void {
    this.snapshot = this.copy();
    for (const listener of this.listeners) listener();
  }
  private data<T>(value: T): T {
    if (!value || typeof value !== "object") return value;
    const known = this.records.get(value);
    if (known) return known as T;
    const copy = Array.isArray(value)
      ? value.map((item) => this.data(item))
      : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.data(item)]));
    Object.freeze(copy);
    this.records.set(value, copy);
    return copy as T;
  }
  private section<T extends object>(next: T, previous?: T): T {
    if (
      previous &&
      Object.keys(next).every((key) => Object.is(next[key as keyof T], previous[key as keyof T]))
    )
      return previous;
    return Object.freeze(next);
  }
  private copy(): AppSnapshot {
    const state = this.state;
    const previous = this.snapshot;
    return Object.freeze({
      ...state,
      playback: this.section(
        {
          ...state.playback,
          current: this.data(state.playback.current),
          queue: this.data(state.playback.queue),
          source: this.data(state.playback.source),
        },
        previous?.playback,
      ),
      navigation: this.section({ ...state.navigation }, previous?.navigation),
      auth: this.section(
        { ...state.auth, ...(state.auth.user && { user: this.data(state.auth.user) }) },
        previous?.auth,
      ),
      catalog: this.section(
        {
          ...state.catalog,
          artists: this.data(state.catalog.artists),
          recentArtists: this.data(state.catalog.recentArtists),
          artist: this.data(state.catalog.artist),
          albums: this.data(state.catalog.albums),
          stations: this.data(state.catalog.stations),
        },
        previous?.catalog,
      ),
      library: this.section(
        { liked: this.data(state.library.liked), busyIds: this.data(state.library.busyIds) },
        previous?.library,
      ),
      requests: this.section({ ...state.requests }, previous?.requests),
      lyrics: this.data(state.lyrics),
      notice: this.data(state.notice),
    });
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "音乐服务暂时不可用，请重试";
}
export function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}
