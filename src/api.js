// QQ response formats stay at this boundary; views consume normalized records.
export function safeUrl(value) {
	try {
		const url = new URL(value);
		return ["http:", "https:"].includes(url.protocol) &&
			!url.username &&
			!url.password
			? url.href.replace(/^http:/, "https:")
			: "";
	} catch {
		return "";
	}
}

export const playbackQualities = [
	{ id: "flac", sizes: ["size_flac"] },
	{ id: "320", sizes: ["size_320mp3"] },
	{ id: "128", sizes: ["size_128mp3"] },
	{
		id: "m4a",
		sizes: ["size_192aac", "size_96aac", "size_48aac", "size_24aac"],
	},
];
export function getTrackQualities(
	track,
	supportedQualities = playbackQualities.map((item) => item.id),
) {
	const advertised =
		Array.isArray(track.qualities) && track.qualities.length
			? track.qualities
			: null;
	return playbackQualities
		.map((item) => item.id)
		.filter(
			(id) =>
				supportedQualities.includes(id) &&
				(!advertised || advertised.includes(id)),
		);
}
export function normalizeTrack(value) {
	const song = value?.musicData || value?.songInfo || value;
	const id = song?.mid || song?.songmid;
	if (!id) return null;
	const singers = Array.isArray(song.singer) ? song.singer : [];
	const albumId = song.album?.mid || song.albummid;
	return {
		id: String(id),
		songId: Number(song.id ?? song.songid) || null,
		songType: Number(song.type ?? song.songtype) || 0,
		title: String(song.title || song.name || song.songname || "未命名歌曲"),
		artist:
			singers
				.map((s) => s.name || s.title)
				.filter(Boolean)
				.join(" / ") || "未知歌手",
		artistId: String(singers[0]?.mid || ""),
		album: String(song.album?.name || song.albumname || ""),
		albumId: String(albumId || ""),
		duration: Math.max(0, Number(song.interval) || 0),
		mediaId: String(song.file?.media_mid || song.strMediaMid || id),
		coverUrl: albumId
			? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${encodeURIComponent(albumId)}.jpg`
			: "",
		qualities: playbackQualities
			.filter((item) =>
				item.sizes.some((size) => Number(song.file?.[size]) > 0),
			)
			.map((item) => item.id),
		vip: !!song.pay?.pay_play,
		art: "original",
	};
}
export function normalizeTracks(list) {
	return [
		...new Map(
			(Array.isArray(list) ? list : [])
				.map(normalizeTrack)
				.filter(Boolean)
				.map((t) => [t.id, t]),
		).values(),
	];
}
export function normalizeArtist(singer) {
	const id = singer?.singer_mid || singer?.mid;
	if (!id) return null;
	const name = String(singer.singer_name || singer.name || "未知歌手");
	return {
		id: String(id),
		name,
		initial: name[0],
		color: "green",
		followerCount: null,
		avatarUrl:
			safeUrl(singer.singer_pic || singer.pic) ||
			`https://y.gtimg.cn/music/photo_new/T001R150x150M000${encodeURIComponent(id)}.jpg`,
	};
}
export function normalizeBaseUrl(value) {
	if (!String(value || "").trim()) return "";
	const url = new URL(String(value).trim());
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	)
		throw new Error("请输入有效的 HTTP 或 HTTPS 服务地址");
	return url.href.replace(/\/$/, "");
}
export function artworkUrl(value) {
	const url = safeUrl(value);
	return url ? `./art?url=${encodeURIComponent(url)}` : "./assets/coast.jpg";
}
export class QQMusicProvider {
	constructor({
		baseUrl = "",
		fetcher = globalThis.fetch,
		timeout = 15000,
		supportedQualities = playbackQualities.map((item) => item.id),
	} = {}) {
		this.baseUrl = normalizeBaseUrl(baseUrl);
		this.fetcher = fetcher.bind(globalThis);
		this.timeout = timeout;
		this.supportedQualities = supportedQualities;
		this.followerCache = new Map();
	}
	async request(path, params = {}, { signal, method = "GET", body: requestBody } = {}) {
		const base =
			this.baseUrl ||
			(globalThis.location?.protocol === "interlude:"
				? "interlude://app/api"
				: "/api");
		const query = new URLSearchParams(
			Object.entries(params).filter(([, v]) => v !== undefined),
		);
		const timeout = AbortSignal.timeout(this.timeout);
		let result;
		try {
			const response = await this.fetcher(`${base}${path}?${query}`, {
				signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
				method, credentials: "same-origin",
				...(requestBody !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) } : {}),
			});
			if (response.status === 401) {
				const error = new Error("登录已过期，请重新登录");
				error.code = "AUTH_REQUIRED";
				if (!path.startsWith("/auth/")) this.onAuthenticationRequired?.();
				throw error;
			}
			if (!response.ok)
			{
				let detail;
				try { detail = (await response.json()).error; } catch { /* Fall back to status. */ }
				const error = new Error(detail?.message || (
					response.status === 502
						? "无法连接本地音乐服务，请确认 qq-music-api 已在 3200 端口启动"
						: `音乐服务请求失败（${response.status}）`
				));
				error.code = detail?.code;
				throw error;
			}
			try {
				result = await response.json();
			} catch {
				throw new Error("本地音乐服务返回了无效数据，请检查 qq-music-api");
			}
		} catch (error) {
			if (signal?.aborted) throw error;
			if (timeout.aborted) throw new Error("音乐服务响应超时，请重试");
			if (error instanceof TypeError)
				throw new Error(
					"无法连接本地音乐服务，请确认 qq-music-api 已在 3200 端口启动",
				);
			throw error;
		}
		const body = result.response ?? result.data ?? result;
		if (
			result.error ||
			(body.code !== undefined && ![0, 200].includes(Number(body.code)))
		)
			throw new Error("QQ 音乐暂时无法提供数据，请稍后重试");
		return body;
	}
	async getAuthStatus() {
		try { return await this.request("/auth/status"); }
		catch (error) { if (error.code === "AUTH_REQUIRED") return { authenticated: false }; throw error; }
	}
	createLoginQr() { return this.request("/auth/qr", {}, { method: "POST", body: {} }); }
	checkLoginQr(id) { return this.request("/auth/qr/check", {}, { method: "POST", body: { id } }); }
	logout() { return this.request("/auth/logout", {}, { method: "POST", body: {} }); }
	async getFavorites() {
		const songs = [];
		let offset = 0;
		for (let page = 0; page < 2000; page++) {
			const result = await this.request("/user/favorites", { offset, limit: 100 });
			if (!Array.isArray(result.songs) || typeof result.hasMore !== "boolean") throw new Error("收藏列表数据不完整，请重试");
			songs.push(...result.songs);
			if (!result.hasMore) return normalizeTracks(songs);
			if (!Number.isSafeInteger(result.nextOffset) || result.nextOffset <= offset) throw new Error("收藏列表分页未前进，请重试");
			offset = result.nextOffset;
		}
		throw new Error("收藏列表过大，未能完成同步");
	}
	async setFavorite(track, liked) {
		let songId = track.songId, songType = track.songType || 0;
		if (!Number.isSafeInteger(songId) || songId <= 0) {
			const result = await this.request("/getSongInfo", { songmid: track.id });
			if (result.songinfo?.code) throw new Error("无法获取歌曲资料，请重试");
			const song = normalizeTrack(result.songinfo?.data?.track_info);
			if (!song || song.id !== track.id || !Number.isSafeInteger(song.songId) || song.songId <= 0) throw new Error("无法确认这首歌的收藏编号");
			songId = song.songId;
			songType = song.songType;
		}
		const result = await this.request("/user/favorites", {}, { method: "POST", body: { songId, songType, liked } });
		if (result.liked !== liked) throw new Error("QQ 音乐未确认收藏更改，请重试");
		return { ...track, songId, songType };
	}
	async searchArtists(query, options) {
		const term = query.trim();
		const body = await this.request(
			term ? "/getSmartbox" : "/getSingerList",
			term ? { key: term } : { page: 1 },
			options,
		);
		const list = term
			? body.data?.singer?.itemlist
			: body.singerList?.data?.singerlist;
		return (list || []).map(normalizeArtist).filter(Boolean);
	}
	async getFollowerCount(id, options) {
		if (this.followerCache.has(id)) return this.followerCache.get(id);
		const body = await this.request(
			"/getSingerStarNum",
			{ singermid: id },
			options,
		);
		const value = Number(body.num);
		const count = Number.isSafeInteger(value) && value >= 0 ? value : null;
		if (count !== null) this.followerCache.set(id, count);
		return count;
	}
	async getArtistTracks(id, page = 1) {
		const body = await this.request("/getSingerHotsong", {
			singermid: id,
			limit: 50,
			page,
		});
		if (body.singer?.code) throw new Error("暂时无法获取这位歌手的歌曲");
		return normalizeTracks(body.singer?.data?.songlist);
	}
	async getRadioStations() {
		const body = await this.request("/getRadioLists");
		const groups = body.data?.data?.groupList || body.data?.groupList || [];
		return groups
			.flatMap((group) =>
				(group.radioList || []).map((radio) => ({
					id: String(radio.radioId),
					name: String(radio.radioName),
					group: String(group.name),
					coverUrl: safeUrl(radio.radioImg),
				})),
			)
			.filter((r) => r.id !== "99"); // Personal radio requires an account; public stations do not.
	}
	async getRadioTracks(id = "199", firstplay = 1) {
		const body = await this.request("/getRadioTracks", { id, firstplay });
		if (body.radio?.code || body.req_0?.code)
			throw new Error("电台暂时无法提供歌曲，请换一个频道");
		return normalizeTracks((body.radio || body.req_0)?.data?.track_list);
	}
	async getRecommendedTracks() {
		const body = await this.request("/getRecommend");
		return normalizeTracks(body.new_song?.data?.songlist);
	}
	async getPlayback(track, { signal } = {}) {
		// File sizes describe available encodings, while a nonempty vkey URL confirms account access.
		// Try browser-supported encodings in descending quality; network failures remain retryable.
		for (const quality of getTrackQualities(track, this.supportedQualities)) {
			signal?.throwIfAborted();
			const body = await this.request(
				"/getMusicPlay",
				{
					songmid: track.id,
					mediaId: track.mediaId,
					quality,
				},
				{ signal },
			);
			const url = safeUrl(body.playUrl?.[track.id]?.url);
			if (url) return url;
		}
		throw new Error(
			"这首歌暂无播放权限或链接，请切换歌曲；付费歌曲需要服务端配置有效账号",
		);
	}

	async getLyrics(id) {
		const body = await this.request("/getLyric", {
			songmid: id,
			isFormat: false,
		});
		return parseLyrics(body.lyric || "");
	}
	async checkConnection() {
		const body = await this.request("/getHotkey");
		if (!body || typeof body !== "object")
			throw new Error("这不是可用的 QQ Music API 服务");
		return true;
	}
}
export function parseLyrics(text) {
	if (typeof text !== "string") return [];
	const offset = Number(text.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0) / 1000;
	const result = [];
	for (const line of text.split(/\r?\n/)) {
		const matches = [...line.matchAll(/\[(\d+):(\d{2})(?:\.(\d{1,3}))?\]/g)];
		const content = line.replace(/\[[^\]]*\]/g, "").trim();
		if (!content) continue;
		for (const m of matches)
			result.push({
				time: Math.max(
					0,
					Number(m[1]) * 60 + Number(m[2]) + Number(`0.${m[3] || 0}`) - offset,
				),
				text: content,
			});
	}
	return result.sort((a, b) => a.time - b.time);
}
