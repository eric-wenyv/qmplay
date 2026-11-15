import { AudioTransport, type AudioElementLike } from "../audio.js";
import { PlayerSession, orderLabels } from "../player.js";
import type { Library, QueueHistoryEntry, Resource, SourceType, Track } from "../contracts.js";
import { queueHistoryLimit } from "../storage.js";
import type { ApplicationProvider } from "./provider.js";
import type { ApplicationStore } from "./store.js";
import { errorMessage } from "./store.js";

interface PlaybackEffects {
  save(): void;
  notice(message: string): void;
  reportError(message: string, retry: () => unknown): void;
  currentChanged(): void;
  stationPreview(id: string): Promise<Track[]> | undefined;
  stationLoaded(id: string, tracks: Track[]): void;
  now(): number;
}
interface MoreRequest {
  version: number;
  controller: AbortController;
  promise: Promise<boolean>;
}

function sameQueue(left: QueueHistoryEntry, right: QueueHistoryEntry): boolean {
  return (
    left.source?.type === right.source?.type &&
    left.source?.resource?.id === right.source?.resource?.id &&
    left.queue.length === right.queue.length &&
    left.queue.every((track, index) => track.id === right.queue[index]?.id)
  );
}

/** Queue ownership and asynchronous playback are independent of browsing and rendering. */
export class PlaybackController {
  readonly session = new PlayerSession();
  readonly transport: AudioTransport;
  private sourceVersion = 0;
  private trackVersion = 0;
  private advanceVersion = 0;
  private queueVersion = 0;
  private sourceAbort: AbortController | null = null;
  private moreRequest: MoreRequest | null = null;
  private lastSaved = 0;
  constructor(
    private store: ApplicationStore,
    private provider: ApplicationProvider,
    audio: AudioElementLike,
    private effects: PlaybackEffects,
  ) {
    this.transport = new AudioTransport({
      audio,
      provider,
      onState: (state) => {
        this.session.playing = state.playing;
        this.publish();
      },
      onProgress: (elapsed, duration) => {
        if (
          this.session.current &&
          Number.isFinite(duration) &&
          duration > 0 &&
          this.session.current.duration !== duration
        )
          this.session.queue = this.session.queue.map((track, index) =>
            index === this.session.index ? { ...track, duration } : track,
          );
        this.session.elapsed = elapsed;
        this.publish();
        if (this.effects.now() - this.lastSaved > 5000) {
          this.lastSaved = this.effects.now();
          this.effects.save();
        }
      },
      onEnded: () => {
        void this.advance("next", true);
      },
      onError: (error) => this.effects.reportError(error.message, () => this.play()),
    });
  }
  publish(): void {
    const state = this.store.state.playback;
    Object.assign(state, {
      current: this.session.current,
      queue: this.session.queue,
      index: this.session.index,
      elapsed: this.session.elapsed,
      playing: this.session.playing,
      desiredPlaying: this.transport?.desiredPlaying || false,
      loading: this.transport?.loading || false,
      order: this.session.order,
      source: this.session.source,
    });
    this.store.publish();
  }
  restore(preferences: Library, { load = true } = {}): void {
    this.queueVersion++;
    this.store.state.playback.history = preferences.queueHistory;
    this.session.order = preferences.order;
    this.session.setQueue(preferences.queue, {
      autoplay: false,
      trackId: preferences.currentId,
      trackIndex: preferences.currentIndex,
      source: preferences.queueSource,
    });
    this.session.seek(preferences.elapsed);
    this.publish();
    if (!load) return;
    this.effects.save();
    if (this.session.current) void this.loadCurrent({ elapsed: this.session.elapsed });
    else if (!preferences.hasQueue && this.session.source && this.session.source.type !== "liked")
      void this.switchSource(this.session.source.type, this.session.source.resource, {
        autoplay: false,
      });
  }
  cancelSource(): void {
    this.sourceVersion++;
    this.sourceAbort?.abort();
    this.store.state.requests.source = false;
  }
  stop(): void {
    this.cancelSource();
    this.trackVersion++;
    this.advanceVersion++;
    this.moreRequest?.controller.abort();
    this.moreRequest = null;
    this.store.state.requests.more = false;
    this.transport.suspend();
  }
  reset(): void {
    this.queueVersion++;
    this.stop();
    this.transport.stop();
    this.store.state.playback.history = [];
    this.session.setQueue([], { autoplay: false });
    this.publish();
  }
  async loadCurrent({ autoplay = false, elapsed = 0 } = {}): Promise<void> {
    this.trackVersion++;
    this.session.elapsed = elapsed;
    this.publish();
    this.effects.currentChanged();
    this.store.publish();
    this.effects.save();
    await this.transport.select(this.session.current, { autoplay, elapsed });
    if (autoplay) this.prefetch();
  }
  private replaceQueue(
    next: QueueHistoryEntry,
    selection: { trackId?: string; trackIndex?: number },
  ) {
    const current = { queue: this.session.queue, source: this.session.source };
    const playback = this.store.state.playback;
    const archive = current.queue.length > 0 && !sameQueue(current, next);
    const history = playback.history.filter(
      (entry) => !sameQueue(entry, next) && !(archive && sameQueue(entry, current)),
    );
    playback.history = (archive ? [current, ...history] : history).slice(0, queueHistoryLimit);
    this.moreRequest?.controller.abort();
    this.moreRequest = null;
    this.store.state.requests.more = false;
    this.queueVersion++;
    this.session.setQueue(next.queue, { ...selection, autoplay: false, source: next.source });
  }
  async playQueueHistory(index: number, trackIndex?: number): Promise<void> {
    const entry = this.store.state.playback.history[index];
    if (!entry || (trackIndex !== undefined && !entry.queue[trackIndex])) return;
    this.cancelSource();
    this.replaceQueue(entry, { trackIndex });
    await this.loadCurrent({ autoplay: true });
  }
  async switchSource(
    type: SourceType,
    resource?: Resource | null,
    { autoplay = true, trackId }: { autoplay?: boolean; trackId?: string } = {},
  ): Promise<void> {
    const version = ++this.sourceVersion;
    this.sourceAbort?.abort();
    const controller = (this.sourceAbort = new AbortController());
    const signal = controller.signal;
    this.store.state.navigation.menuOpen = false;
    this.store.state.requests.source = true;
    this.store.publish();
    try {
      let queue: Track[];
      let page: { tracks: Track[]; hasMore: boolean } | undefined;
      if (type === "liked") queue = [...this.store.state.library.liked];
      else {
        if (!resource) throw new Error("请选择一个音乐来源");
        if (type === "artist" || type === "album") {
          page = await (type === "artist"
            ? this.provider.getArtistTrackPage(resource.id, 1, { signal })
            : this.provider.getAlbumTrackPage(resource.id, 1, { signal }));
          queue = page.tracks;
        } else
          queue = await (this.effects.stationPreview(resource.id) ??
            (resource.id === "daily"
              ? this.provider.getDailyRecommendedTracks({ signal })
              : resource.id === "new"
                ? this.provider.getRecommendedTracks({ signal })
                : this.provider.getRadioTracks(resource.id, 1, { signal })));
      }
      if (version !== this.sourceVersion || signal.aborted) return;
      if (!queue.length) throw new Error("暂时没有可用歌曲，请选择其他来源");
      if (type === "radio" && resource) this.effects.stationLoaded(resource.id, queue);
      this.store.state.requests.source = false;
      this.replaceQueue(
        {
          queue,
          source: {
            type,
            ...(resource && { resource }),
            page: 1,
            ...(page && { hasMore: page.hasMore }),
            ...(type === "radio" && resource?.id === "daily" && { hasMore: false }),
          },
        },
        { trackId },
      );
      this.store.state.announcement = `${type === "liked" ? "喜欢的音乐" : type === "radio" ? "推荐电台" : "歌手电台"}，${queue.length} 首歌曲`;
      await this.loadCurrent({ autoplay });
    } catch (error) {
      if (version === this.sourceVersion && !signal.aborted)
        this.effects.reportError(errorMessage(error), () =>
          this.switchSource(type, resource, { autoplay, trackId }),
        );
    } finally {
      if (version === this.sourceVersion) {
        this.store.state.requests.source = false;
        this.publish();
      }
    }
  }
  private prefetch(): void {
    const source = this.session.source;
    if (
      source &&
      (source.type === "artist" || source.type === "album") &&
      source.hasMore !== false &&
      (this.session.order === "shuffle" || this.session.queue.length - this.session.index <= 6)
    )
      void this.loadMore({ quiet: true });
  }
  async loadMore({ quiet = false } = {}): Promise<boolean> {
    const queue = this.session.queue;
    const version = this.queueVersion;
    const source = this.session.source;
    if (
      !source ||
      source.type === "liked" ||
      source.hasMore === false ||
      !source.resource ||
      (source.type === "radio" && source.resource.id === "daily")
    )
      return false;
    if (this.moreRequest?.version === version) return this.moreRequest.promise;
    const controller = new AbortController();
    const resource = source.resource;
    const request = async (): Promise<boolean> => {
      try {
        const paginated = source.type === "artist" || source.type === "album";
        const known = new Set(queue.map((track) => track.id));
        for (let attempt = 0; attempt < 3; attempt++) {
          const page = paginated
            ? await (source.type === "artist"
                ? this.provider.getArtistTrackPage(resource.id, (source.page || 1) + 1, {
                    signal: controller.signal,
                  })
                : this.provider.getAlbumTrackPage(resource.id, (source.page || 1) + 1, {
                    signal: controller.signal,
                  }))
            : null;
          const tracks = page
            ? page.tracks
            : resource.id === "new"
              ? await this.provider.getRecommendedTracks({ signal: controller.signal })
              : await this.provider.getRadioTracks(resource.id, 0, { signal: controller.signal });
          if (version !== this.queueVersion || controller.signal.aborted) return false;
          const added = tracks.filter((track) => {
            if (known.has(track.id)) return false;
            known.add(track.id);
            return true;
          });
          if (!paginated) added.splice(Math.max(0, 1000 - this.session.queue.length));
          if (page) {
            source.page = (source.page || 1) + 1;
            source.hasMore = page.hasMore;
            this.session.source = { ...source };
          }
          if (!added.length) {
            if (page?.hasMore) continue;
            this.effects.save();
            if (!quiet && !paginated) this.effects.notice("暂时没有更多歌曲，可以切换其他电台");
            return false;
          }
          this.session.queue = [...this.session.queue, ...added];
          this.effects.save();
          if (!quiet) this.store.state.announcement = `已添加 ${added.length} 首歌曲`;
          return true;
        }
        throw new Error("歌曲列表分页未前进，请重试");
      } catch (error) {
        if (version === this.queueVersion && !controller.signal.aborted)
          this.effects.reportError(errorMessage(error), () => this.loadMore());
        return false;
      }
    };
    const pending: MoreRequest = { version, controller, promise: Promise.resolve(false) };
    this.moreRequest = pending;
    this.store.state.requests.more = true;
    pending.promise = request();
    this.store.publish();
    const result = await pending.promise;
    if (controller.signal.aborted || version !== this.queueVersion) return false;
    if (this.moreRequest === pending) {
      this.moreRequest = null;
      this.store.state.requests.more = false;
    }
    this.publish();
    return result;
  }
  togglePlay(): void {
    if (!this.session.current) return;
    if (this.transport.desiredPlaying || this.session.playing) this.pause();
    else void this.play();
  }
  async play(): Promise<void> {
    await this.transport.play();
    this.publish();
  }
  pause(): void {
    this.transport.pause();
    this.publish();
  }
  seek(seconds: number): void {
    this.transport.seek(seconds);
    this.effects.save();
  }
  async advance(
    direction: "next" | "previous",
    automatic = false,
    { skipCurrent = false } = {},
  ): Promise<void> {
    if (!this.session.current) return;
    const version = ++this.advanceVersion;
    const autoplay =
      skipCurrent || automatic || this.session.playing || this.transport.desiredPlaying;
    if (!skipCurrent && direction === "previous" && this.session.elapsed > 3) {
      this.seek(0);
      return;
    }
    if (automatic && this.session.order === "repeatOne" && !this.session.hasQueuedNext) {
      this.seek(0);
      await this.play();
      return;
    }
    const source = this.session.source;
    if (
      direction === "next" &&
      source &&
      ((source.type === "radio" && automatic && this.session.order === "repeat") ||
        ((source.type === "artist" || source.type === "album") && source.hasMore !== false)) &&
      this.session.index === this.session.queue.length - 1
    ) {
      const queueVersion = this.queueVersion,
        selectedVersion = this.trackVersion,
        transportVersion = this.transport.version;
      await this.loadMore();
      if (
        queueVersion !== this.queueVersion ||
        selectedVersion !== this.trackVersion ||
        version !== this.advanceVersion ||
        transportVersion !== this.transport.version
      )
        return;
      if (
        (source.type === "artist" || source.type === "album") &&
        source.hasMore !== false &&
        this.session.index === this.session.queue.length - 1
      )
        return;
    }
    direction === "next"
      ? this.session.next()
      : this.session.previous({ restartCurrent: !skipCurrent });
    await this.loadCurrent({ autoplay });
  }
  cycleOrder(): void {
    this.session.cycleOrder();
    this.store.state.announcement = orderLabels[this.session.order];
    this.prefetch();
    this.effects.save();
    this.publish();
  }
  async selectTrack(index: number): Promise<void> {
    if (!this.session.select(index)) return;
    await this.loadCurrent({ autoplay: true });
  }
  async insertTrackNext(track: Track, { autoplay = false } = {}): Promise<void> {
    this.cancelSource();
    this.advanceVersion++;
    const hadCurrent = !!this.session.current;
    if (!hadCurrent) {
      this.queueVersion++;
      this.moreRequest?.controller.abort();
      this.moreRequest = null;
      this.store.state.requests.more = false;
    }
    const index = this.session.insertNext(track);
    this.store.state.announcement = autoplay
      ? `正在播放 ${track.title}`
      : `已添加到下一首播放：${track.title}`;
    if (autoplay) {
      this.session.select(index);
      await this.loadCurrent({ autoplay: true });
    } else if (!hadCurrent) await this.loadCurrent();
    else {
      this.effects.save();
      this.publish();
    }
  }
  removeTrack(index: number): void {
    if (!this.session.queue[index]) return;
    const autoplay = this.session.playing || this.transport.desiredPlaying;
    const removingCurrent = index === this.session.index;
    this.session.remove(index);
    if (removingCurrent) {
      this.session.elapsed = 0;
      void this.loadCurrent({ autoplay });
    }
    this.effects.save();
    this.publish();
  }
}
