const preferenceKey = "interlude-library-v2";
export function validTrack(track) {
	return (
		track &&
		typeof track.id === "string" &&
		/^[\w-]{1,100}$/.test(track.id) &&
		typeof track.title === "string"
	);
}
export function readLibrary(storage = globalThis.localStorage) {
	try {
		const data = JSON.parse(storage.getItem(preferenceKey) || "{}");
		return {
			accountUin: typeof data.accountUin === "string" ? data.accountUin : "",
			liked: Array.isArray(data.liked)
				? data.liked.filter(validTrack).slice(0, 5000)
				: [],
			queue: Array.isArray(data.queue)
				? data.queue.filter(validTrack).slice(0, 1000)
				: [],
			volume: Number.isFinite(data.volume)
				? Math.max(0, Math.min(100, data.volume))
				: 65,
			order: ["repeat", "shuffle", "repeatOne"].includes(data.order)
				? data.order
				: "repeat",
			mode: ["radio", "artist", "liked"].includes(data.mode)
				? data.mode
				: "radio",
			station:
				data.station && /^(new|\d+)$/.test(data.station.id)
					? data.station
					: { id: "new", name: "每日新歌" },
			artist:
				data.artist && typeof data.artist.id === "string" ? data.artist : null,
			currentId: typeof data.currentId === "string" ? data.currentId : "",
			elapsed: Math.max(0, Number(data.elapsed) || 0),
		};
	} catch {
		return {
			liked: [],
			queue: [],
			volume: 65,
			order: "repeat",
			mode: "radio",
			station: { id: "new", name: "每日新歌" },
			artist: null,
			elapsed: 0,
		};
	}
}
export function writeLibrary(data, storage = globalThis.localStorage) {
	try {
		// Legacy service/quality settings and expiring audio URLs are never persisted.
		const { baseUrl, quality, ...library } = data;
		const clean = (track) => {
			const { url, playbackUrl, ...value } = track;
			return value;
		};
		storage.setItem(
			preferenceKey,
			JSON.stringify({
				...library,
				queue: data.queue.map(clean),
				liked: data.liked.map(clean),
			}),
		);
		return true;
	} catch {
		return false;
	}
}
