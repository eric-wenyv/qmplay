import type { PlayOrder, QueueSource, Track } from "./contracts.js";

export const orderModes: PlayOrder[] = ["repeat", "shuffle", "repeatOne"];
export const orderLabels: Record<PlayOrder, string> = {
  repeat: "列表循环",
  shuffle: "随机播放",
  repeatOne: "单曲循环",
};

export function formatTime(seconds: unknown) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

export class PlayerSession {
  random: () => number;
  history: number[];
  queue: Track[];
  order: PlayOrder;
  source: QueueSource | null;
  index: number;
  elapsed: number;
  playing: boolean;
  private upNext: number[] = [];
  constructor(random = Math.random) {
    this.random = random;

    this.history = [];
    this.queue = [];
    this.order = "repeat";

    this.source = null;

    this.index = 0;
    this.elapsed = 0;
    this.playing = false;
  }

  get current() {
    return this.queue[this.index] || null;
  }

  setQueue(
    queue: Track[],
    {
      autoplay = true,
      trackId,
      trackIndex,
      source = null,
    }: {
      autoplay?: boolean;
      trackId?: string;
      trackIndex?: number;
      source?: QueueSource | null;
    } = {},
  ) {
    this.queue = [...queue];
    this.source = source && {
      ...source,
      ...(source.resource && { resource: { ...source.resource } }),
    };
    this.index =
      typeof trackIndex === "number" &&
      Number.isInteger(trackIndex) &&
      trackIndex >= 0 &&
      trackIndex < this.queue.length &&
      (!trackId || this.queue[trackIndex]?.id === trackId)
        ? trackIndex
        : Math.max(
            0,
            this.queue.findIndex((track) => track.id === trackId),
          );
    this.elapsed = 0;
    this.history = [];
    this.playing = autoplay && this.queue.length > 0;
    this.upNext = [];
  }

  get hasQueuedNext() {
    return this.upNext.length > 0;
  }

  insertNext(track: Track): number {
    if (!this.current) {
      this.setQueue([track], { autoplay: false });
      return 0;
    }
    const index = this.index + 1;
    this.queue = [...this.queue.slice(0, index), track, ...this.queue.slice(index)];
    this.history = this.history.map((value) => (value >= index ? value + 1 : value));
    this.upNext = [index, ...this.upNext.map((value) => (value >= index ? value + 1 : value))];
    return index;
  }

  remove(index: number): boolean {
    if (!this.queue[index]) return false;
    const removingCurrent = index === this.index;
    this.queue = this.queue.filter((_, value) => value !== index);
    this.history = this.history
      .filter((value) => value !== index)
      .map((value) => (value > index ? value - 1 : value));
    this.upNext = this.upNext
      .filter((value) => value !== index)
      .map((value) => (value > index ? value - 1 : value));
    if (index < this.index) this.index--;
    else if (index === this.index) this.index = Math.min(index, Math.max(0, this.queue.length - 1));
    if (removingCurrent) this.upNext = this.upNext.filter((value) => value !== this.index);
    return true;
  }

  select(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= this.queue.length) return false;
    if (index !== this.index) this.history.push(this.index);
    if (this.history.length > 500) this.history.shift();
    this.index = index;
    this.upNext = this.upNext.filter((value) => value !== index);
    this.elapsed = 0;
    this.playing = true;
    return true;
  }

  next({ automatic = false } = {}) {
    if (!this.current) return;
    if (automatic && this.order === "repeatOne" && !this.hasQueuedNext) {
      this.elapsed = 0;
      return;
    }
    this.history.push(this.index);
    if (this.history.length > 500) this.history.shift();
    const queued = this.upNext.shift();
    if (queued !== undefined) this.index = queued;
    else if (this.order === "shuffle" && this.queue.length > 1) {
      const offset =
        1 + Math.min(this.queue.length - 2, Math.floor(this.random() * (this.queue.length - 1)));
      this.index = (this.index + offset) % this.queue.length;
    } else this.index = (this.index + 1) % this.queue.length;
    this.elapsed = 0;
  }

  previous() {
    if (!this.current) return;
    if (this.elapsed > 3) {
      this.elapsed = 0;
      return;
    }
    this.index = this.history.pop() ?? (this.index - 1 + this.queue.length) % this.queue.length;
    this.elapsed = 0;
  }

  seek(value: unknown) {
    this.elapsed = Math.max(0, Math.min(this.current?.duration || 0, Number(value) || 0));
  }

  cycleOrder() {
    this.order = orderModes[(orderModes.indexOf(this.order) + 1) % orderModes.length];
    return this.order;
  }
}
