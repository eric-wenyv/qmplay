import type { RequestOptions, Track } from "./contracts.js";

/** The small media interface also permits deterministic audio test doubles. */
export interface AudioLike extends EventTarget {
  paused: boolean;
  ended: boolean;
  readyState: number;
  currentTime: number;
  duration: number;
  preload: string;
  src: string;
  error?: unknown;
  load(): void;
  removeAttribute(name: string): void;
  pause(): void;
  play(): Promise<void>;
}
export type AudioElementLike = AudioLike;
export interface AudioTransportOptions {
  audio: AudioLike;
  provider: {
    getPlayback(track: Track, options?: RequestOptions): Promise<string>;
  };
  onState?: (state: { playing: boolean; loading: boolean }) => void;
  onProgress?: (elapsed: number, duration: number) => void;
  onEnded?: () => void;
  onError?: (error: Error) => void;
}

// The media element is the clock. No simulated progress or play state.
export class AudioTransport {
  readonly audio: AudioLike;
  readonly provider: AudioTransportOptions["provider"];
  readonly onState: NonNullable<AudioTransportOptions["onState"]>;
  readonly onProgress: NonNullable<AudioTransportOptions["onProgress"]>;
  readonly onEnded: NonNullable<AudioTransportOptions["onEnded"]>;
  readonly onError: NonNullable<AudioTransportOptions["onError"]>;
  version = 0;
  track: Track | null = null;
  loadedId: string | null = null;
  desiredPlaying = false;
  loading = false;
  pendingSeek = 0;
  playbackAbort?: AbortController;
  private readonly listeners: Array<[string, EventListener]> = [];
  private listening = true;

  constructor({
    audio,
    provider,
    onState = () => {},
    onProgress = () => {},
    onEnded = () => {},
    onError = () => {},
  }: AudioTransportOptions) {
    this.audio = audio;
    this.provider = provider;
    this.onState = onState;
    this.onProgress = onProgress;
    this.onEnded = onEnded;
    this.onError = onError;
    audio.preload = "metadata";
    for (const name of ["playing", "pause", "waiting", "canplay"])
      this.listen(name, () => {
        if (name === "playing" || name === "canplay") this.loading = false;
        if (name === "waiting" && this.desiredPlaying) this.loading = true;
        this.emit();
      });
    this.listen("timeupdate", () => this.onProgress(audio.currentTime || 0, audio.duration));
    this.listen("loadedmetadata", () => {
      if (this.pendingSeek && Number.isFinite(audio.duration)) {
        audio.currentTime = Math.min(this.pendingSeek, audio.duration);
        this.pendingSeek = 0;
      }
      this.onProgress(audio.currentTime || 0, audio.duration);
    });
    this.listen("ended", () => {
      this.desiredPlaying = false;
      this.onEnded();
    });
    this.listen("error", () => {
      if (!this.loadedId || !audio.error) return;
      this.desiredPlaying = false;
      this.loading = false;
      this.loadedId = null;
      this.emit();
      this.onError(new Error("音频加载失败，请重试或切换歌曲"));
    });
  }
  private listen(name: string, listener: EventListener): void {
    this.audio.addEventListener(name, listener);
    this.listeners.push([name, listener]);
  }
  /** Suspend host events without losing the selected track or pending resume position. */
  suspend(): void {
    this.pause();
    if (!this.listening) return;
    for (const [name, listener] of this.listeners) this.audio.removeEventListener(name, listener);
    this.listening = false;
  }
  resume(): void {
    if (this.listening) return;
    for (const [name, listener] of this.listeners) this.audio.addEventListener(name, listener);
    this.listening = true;
  }
  dispose(): void {
    this.suspend();
    this.loadedId = null;
    this.track = null;
    this.audio.removeAttribute("src");
    this.audio.load();
    this.listeners.length = 0;
  }
  emit(): void {
    this.onState({
      playing: !this.audio.paused && !this.audio.ended,
      loading: this.loading,
    });
  }
  stop(): void {
    this.playbackAbort?.abort();
    this.version++;
    this.desiredPlaying = false;
    this.loading = false;
    this.loadedId = null;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.emit();
  }
  async select(track: Track | null, { autoplay = false, elapsed = 0 } = {}): Promise<void> {
    this.stop();
    this.track = track;
    this.pendingSeek = elapsed;
    if (autoplay) await this.play();
  }
  async play(): Promise<void> {
    if (!this.track) return;
    this.playbackAbort?.abort();
    this.playbackAbort = new AbortController();
    this.desiredPlaying = true;
    const version = ++this.version;
    try {
      if (this.loadedId !== this.track.id) {
        this.loading = true;
        this.emit();
        const url = await this.provider.getPlayback(this.track, {
          signal: this.playbackAbort.signal,
        });
        if (version !== this.version || !this.desiredPlaying) return;
        this.audio.src = url;
        this.loadedId = this.track.id;
        this.audio.load();
      }
      if (version !== this.version || !this.desiredPlaying) return;
      await this.audio.play();
      if (version !== this.version) return;
      this.loading = false;
      this.emit();
    } catch (error) {
      if (version !== this.version) return;
      this.desiredPlaying = false;
      this.loading = false;
      this.emit();
      const failure = error instanceof Error ? error : new Error(String(error));
      if (failure.name !== "NotAllowedError") this.loadedId = null;
      this.onError(
        new Error(
          failure.name === "NotAllowedError" ? "浏览器需要点击播放按钮后才能播放" : failure.message,
        ),
      );
    }
  }
  pause(): void {
    this.playbackAbort?.abort();
    this.version++;
    this.desiredPlaying = false;
    this.loading = false;
    this.audio.pause();
    this.emit();
  }
  seek(seconds: unknown): void {
    const duration = Number.isFinite(this.audio.duration)
      ? this.audio.duration
      : this.track?.duration || 0;
    const time = Math.max(0, Math.min(duration, Number(seconds) || 0));
    if (this.loadedId && this.audio.readyState >= 1) this.audio.currentTime = time;
    else this.pendingSeek = time;
    this.onProgress(time, duration);
  }
}
