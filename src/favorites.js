import { validTrack } from './storage.js';
const cacheKey = 'qmplay-account-favorites-v1';
const legacyCacheKey = 'interlude-account-favorites-v1';
export class FavoriteSync {
  constructor({
    provider,
    storage = globalThis.localStorage,
    legacy = [],
    legacyAccount = '',
    onChange = () => {},
  }) {
    Object.assign(this, { provider, storage, onChange });
    this.epoch = 0;
    this.busy = new Set();
    this.work = Promise.resolve();
    this.state = { accounts: {}, migration: { owner: '', tracks: [], done: false } };
    try {
      const saved = JSON.parse(storage.getItem(cacheKey) || storage.getItem(legacyCacheKey) || 'null');
      if (
        saved?.accounts &&
        !Array.isArray(saved.accounts) &&
        saved?.migration &&
        Array.isArray(saved.migration.tracks)
      ) {
        this.state.accounts = Object.fromEntries(
          Object.entries(saved.accounts)
            .filter(([uin, tracks]) => /^\d+$/.test(uin) && Array.isArray(tracks))
            .map(([uin, tracks]) => [uin, tracks.filter(validTrack)]),
        );
        this.state.migration = {
          owner: /^\d+$/.test(saved.migration.owner) ? saved.migration.owner : '',
          tracks: saved.migration.tracks.filter(validTrack),
          done: saved.migration.done === true,
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
  enqueue(operation) {
    const epoch = this.epoch;
    const task = this.work.then(() => (epoch === this.epoch ? operation() : false));
    this.work = task.catch(() => {});
    return task;
  }
  connect(uin) {
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
        migration.owner = '';
        throw new Error('本机无法保存收藏迁移记录，请释放存储空间后重试');
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
  set(track, liked) {
    if (this.busy.has(track.id)) return Promise.resolve(false);
    this.busy.add(track.id);
    const epoch = this.epoch;
    return this.enqueue(() => this.performSet(track, liked)).finally(() => {
      if (epoch === this.epoch) this.busy.delete(track.id);
    });
  }
  async performSet(track, liked) {
    if (!this.uin) throw new Error('请先登录 QQ 音乐');
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
