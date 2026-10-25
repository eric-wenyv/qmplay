// The media element is the clock. No simulated progress or play state.
export class AudioTransport {
	constructor({
		audio,
		provider,
		onState = () => {},
		onProgress = () => {},
		onEnded = () => {},
		onError = () => {},
	}) {
		Object.assign(this, {
			audio,
			provider,
			onState,
			onProgress,
			onEnded,
			onError,
		});
		this.version = 0;
		this.track = null;
		this.loadedId = null;
		this.desiredPlaying = false;
		this.loading = false;
		this.audio.preload = "metadata";
		for (const name of ["playing", "pause", "waiting", "canplay"])
			audio.addEventListener(name, () => {
				if (name === "playing" || name === "canplay") this.loading = false;
				if (name === "waiting" && this.desiredPlaying) this.loading = true;
				this.emit();
			});
		audio.addEventListener("timeupdate", () =>
			onProgress(audio.currentTime || 0, audio.duration),
		);
		audio.addEventListener("loadedmetadata", () => {
			if (this.pendingSeek && Number.isFinite(audio.duration)) {
				audio.currentTime = Math.min(this.pendingSeek, audio.duration);
				this.pendingSeek = 0;
			}
			onProgress(audio.currentTime || 0, audio.duration);
		});
		audio.addEventListener("ended", () => {
			this.desiredPlaying = false;
			onEnded();
		});
		audio.addEventListener("error", () => {
			if (!this.loadedId || !audio.error) return;
			this.desiredPlaying = false;
			this.loading = false;
			this.loadedId = null; // Retry obtains a fresh signed URL.
			this.emit();
			onError(new Error("音频加载失败，请重试或切换歌曲"));
		});
	}
	emit() {
		this.onState({
			playing: !this.audio.paused && !this.audio.ended,
			loading: this.loading,
		});
	}
	stop() {
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
	async select(track, { autoplay = false, elapsed = 0 } = {}) {
		this.stop();
		this.track = track;
		this.pendingSeek = elapsed;
		if (autoplay) await this.play();
	}
	async play() {
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
			if (error.name !== "NotAllowedError") this.loadedId = null;
			this.onError(
				new Error(
					error.name === "NotAllowedError"
						? "浏览器需要点击播放按钮后才能播放"
						: error.message,
				),
			);
		}
	}
	pause() {
		this.playbackAbort?.abort();
		this.version++;
		this.desiredPlaying = false;
		this.loading = false;
		this.audio.pause();
		this.emit();
	}
	seek(seconds) {
		const duration = Number.isFinite(this.audio.duration)
			? this.audio.duration
			: this.track?.duration || 0;
		const time = Math.max(0, Math.min(duration, Number(seconds) || 0));
		if (this.loadedId && this.audio.readyState >= 1)
			this.audio.currentTime = time;
		else this.pendingSeek = time;
		this.onProgress(time, duration);
	}
	setVolume(value) {
		this.audio.volume = Math.max(0, Math.min(1, value / 100));
	}
}
