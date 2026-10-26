const preferenceKey = "qmplay-library-v2";
const legacyPreferenceKey = "interlude-library-v2";
function readQueueSource(data) {
	const source = Object.hasOwn(data, "queueSource") ? data.queueSource : {
		type: data.mode || "radio",
		resource: data.mode === "artist" ? data.artist : data.station,
	};
	if (!source) return null;
	if (source.type === "liked") return { type: "liked" };
	if (["artist", "album"].includes(source.type) && typeof source.resource?.id === "string")
		return {
			type: source.type, resource: source.resource,
			page: Number.isSafeInteger(source.page) && source.page > 0 ? source.page : 1,
			...(typeof source.hasMore === "boolean" && { hasMore: source.hasMore }),
		};
	return {
		type: "radio",
		resource: source.type === "radio" && /^(new|\d+)$/.test(source.resource?.id)
			? source.resource : { id: "new", name: "每日新歌" },
	};
}
export function validTrack(track) {
	return (
		track &&
		typeof track.id === "string" &&
		/^[\w-]{1,100}$/.test(track.id) &&
		typeof track.title === "string"
	);
}
export function artistHistory(history = []) {
	const seen = new Set();
	return (Array.isArray(history) ? history : []).filter((artist) => {
		if (!artist || typeof artist.id !== "string" || !/^[\w-]{1,100}$/.test(artist.id) ||
			typeof artist.name !== "string" || !artist.name.trim() || seen.has(artist.id)) return false;
		seen.add(artist.id);
		return true;
	}).slice(0, 10).map(({ id, name, avatarUrl, followerCount }) => ({
		id, name: name.slice(0, 200),
		avatarUrl: typeof avatarUrl === "string" ? avatarUrl.slice(0, 1000) : "",
		followerCount: Number.isSafeInteger(followerCount) && followerCount >= 0 ? followerCount : null,
	}));
}
export function rememberArtist(history, artist) {
	return artistHistory([artist, ...history.filter((item) => item.id !== artist.id)]);
}
export function readLibrary(storage = globalThis.localStorage) {
	try {
		const data = JSON.parse(storage.getItem(preferenceKey) || storage.getItem(legacyPreferenceKey) || "{}");
		return {
			queueSource: readQueueSource(data),
			artistHistory: artistHistory(data.artistHistory),
			hasQueue: Array.isArray(data.queue),
			accountUin: typeof data.accountUin === "string" ? data.accountUin : "",
			liked: Array.isArray(data.liked)
				? data.liked.filter(validTrack).slice(0, 5000)
				: [],
			queue: Array.isArray(data.queue)
				? data.queue.filter(validTrack)
				: [],
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
export function writeLibrary(data, storage = globalThis.localStorage) {
	try {
		// System audio controls replace legacy volume; discard old service/quality settings too.
		const { baseUrl, quality, volume, ...library } = data;
		const clean = (track) => {
			const { url, playbackUrl, ...value } = track;
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
