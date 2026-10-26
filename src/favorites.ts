import type { StorageLike, Track } from "./contracts.js";
import { validTrack } from "./storage.js";
export interface FavoriteSyncOptions {
  provider: {
    getFavorites(): Promise<Track[]>;
    setFavorite(track: Track, liked: boolean): Promise<Track>;
  };
  storage?: StorageLike;
  legacy?: Track[];
  legacyAccount?: string;
  onChange?: (tracks: Track[]) => void;
}
interface FavoriteCache {
  accounts: Record<string, Track[]>;
  migration: { owner: string; tracks: Track[]; done: boolean };
}
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const cacheKey = "qmplay-account-favorites-v1";
const legacyCacheKey = "interlude-account-favorites-v1";
export class FavoriteSync {
  readonly provider: FavoriteSyncOptions["provider"];
  readonly storage: StorageLike;
  readonly onChange: NonNullable<FavoriteSyncOptions["onChange"]>;
  epoch = 0;
  busy = new Set<string>();
  work: Promise<void> = Promise.resolve();
  state: FavoriteCache = { accounts: {}, migration: { owner: "", tracks: [], done: false } };
  storageFailed = false;
  uin: string | null = null;
  constructor({
    provider,
    storage = globalThis.localStorage,
    legacy = [],
    legacyAccount = "",
    onChange = () => {},
  }: FavoriteSyncOptions) {
    this.provider = provider;
    this.storage = storage;
    this.onChange = onChange;
    try {
      const saved = record(
        JSON.parse(storage.getItem(cacheKey) || storage.getItem(legacyCacheKey) || "null"),
      );
      const accounts = record(saved.accounts),
        migration = record(saved.migration);
      if (
        saved.accounts &&
        !Array.isArray(saved.accounts) &&
        saved.migration &&
        Array.isArray(migration.tracks)
      ) {
        this.state.accounts = Object.fromEntries(
          Object.entries(accounts)
            .filter(([uin, tracks]) => /^\d+$/.test(uin) && Array.isArray(tracks))
            .map(([uin, tracks]) => [uin, (tracks as unknown[]).filter(validTrack)]),
        );
        this.state.migration = {
          owner:
            typeof migration.owner === "string" && /^\d+$/.test(migration.owner)
              ? migration.owner
              : "",
          tracks: migration.tracks.filter(validTrack),
          done: migration.done === true,
        };
      } else if (legacyAccount) this.state.accounts[legacyAccount] = legacy.filter(validTrack);
      else this.state.migration.tracks = legacy.filter(validTrack);
    } catch {
      this.state.migration.tracks = legacyAccount ? [] : legacy.filter(validTrack);
    }
    this.persist(); // Preserve legacy favorites before the first cloud snapshot replaces the old cache.
  }
  persist() {
    try {
      this.storage.setItem(cacheKey, JSON.stringify(this.state));
      this.storageFailed = false;
      return true;
    } catch {
      this.storageFailed = true;
      return false;
    }
  }
  enqueue<T>(operation: () => Promise<T>): Promise<T | false> {
    const epoch = this.epoch;
    const task = this.work.then<T | false>(() => (epoch === this.epoch ? operation() : false));
    this.work = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }
  connect(uin: string) {
    this.epoch++;
    this.uin = uin;
    this.busy.clear();
    this.onChange((this.state.accounts[uin] || []).filter(validTrack));
  }
  disconnect() {
    this.epoch++;
    this.uin = null;
    this.onChange([]);
  }
  sync() {
    return this.enqueue(() => this.performSync());
  }
  async performSync() {
    if (!this.uin) return;
    const epoch = this.epoch,
      uin = this.uin;
    const remote = await this.provider.getFavorites();
    if (epoch !== this.epoch) return;
    const tracks = new Map(remote.map((track) => [track.id, track]));
    this.state.accounts[uin] = [...tracks.values()];
    this.persist();
    this.onChange(this.state.accounts[uin]);
    const migration = this.state.migration;
    if (!migration.owner) {
      migration.owner = uin;
      if (!this.persist() && migration.tracks.length) {
        migration.owner = "";
        throw new Error("本机无法保存收藏迁移记录，请释放存储空间后重试");
      }
    }
    if (migration.owner === uin && !migration.done) {
      for (const track of migration.tracks) {
        if (epoch !== this.epoch) return;
        if (!tracks.has(track.id)) {
          const confirmed = await this.provider.setFavorite(track, true);
          if (epoch !== this.epoch) return;
          tracks.set(confirmed.id, confirmed);
        }
      }
      migration.done = true;
    }
    if (epoch !== this.epoch) return;
    this.state.accounts[uin] = [...tracks.values()];
    this.persist();
    this.onChange(this.state.accounts[uin]);
  }
  async set(track: Track, liked: boolean) {
    if (this.busy.has(track.id)) return Promise.resolve(false);
    this.busy.add(track.id);
    const epoch = this.epoch;
    return this.enqueue(() => this.performSet(track, liked)).finally(() => {
      if (epoch === this.epoch) this.busy.delete(track.id);
    });
  }
  async performSet(track: Track, liked: boolean) {
    if (!this.uin) throw new Error("请先登录 QQ 音乐");
    const epoch = this.epoch,
      uin = this.uin;
    const confirmed = await this.provider.setFavorite(track, liked);
    if (epoch !== this.epoch) return false;
    const tracks = new Map((this.state.accounts[uin] || []).map((item) => [item.id, item]));
    liked ? tracks.set(confirmed.id, confirmed) : tracks.delete(track.id);
    this.state.accounts[uin] = [...tracks.values()];
    this.persist();
    this.onChange(this.state.accounts[uin]);
    return true;
  }
}
