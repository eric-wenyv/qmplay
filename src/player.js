export const orderModes = ["repeat", "shuffle", "repeatOne"];
export const orderLabels = {
	repeat: "列表循环",
	shuffle: "随机播放",
	repeatOne: "单曲循环",
};

export function formatTime(seconds) {
	const value = Math.max(0, Math.floor(Number(seconds) || 0));
	return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

export class PlayerSession {
	constructor(random = Math.random) {
		this.queue = [];
		this.index = 0;
		this.elapsed = 0;
		this.playing = false;
		this.order = "repeat";
		this.history = [];
		this.random = random;
	}

	get current() {
		return this.queue[this.index] || null;
	}

	setQueue(queue, { autoplay = true, trackId } = {}) {
		this.queue = [...queue];
		this.index = Math.max(
			0,
			this.queue.findIndex((track) => track.id === trackId),
		);
		this.elapsed = 0;
		this.history = [];
		this.playing = autoplay && this.queue.length > 0;
	}

	select(index) {
		if (!Number.isInteger(index) || index < 0 || index >= this.queue.length)
			return false;
		if (index !== this.index) this.history.push(this.index);
		this.index = index;
		this.elapsed = 0;
		this.playing = true;
		return true;
	}

	next({ automatic = false } = {}) {
		if (!this.current) return;
		if (automatic && this.order === "repeatOne") {
			this.elapsed = 0;
			return;
		}
		this.history.push(this.index);
		if (this.order === "shuffle" && this.queue.length > 1) {
			const offset =
				1 +
				Math.min(
					this.queue.length - 2,
					Math.floor(this.random() * (this.queue.length - 1)),
				);
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
		this.index =
			this.history.pop() ??
			(this.index - 1 + this.queue.length) % this.queue.length;
		this.elapsed = 0;
	}

	seek(value) {
		this.elapsed = Math.max(
			0,
			Math.min(this.current?.duration || 0, Number(value) || 0),
		);
	}

	tick(seconds = 1) {
		if (!this.playing || !this.current) return false;
		this.elapsed += Math.max(0, Number(seconds) || 0);
		if (this.elapsed >= this.current.duration) {
			this.next({ automatic: true });
			return true;
		}
		return false;
	}

	cycleOrder() {
		this.order =
			orderModes[(orderModes.indexOf(this.order) + 1) % orderModes.length];
		return this.order;
	}
}
