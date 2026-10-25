import test from "node:test";
import assert from "node:assert/strict";
import {
	QQMusicProvider,
	normalizeTrack,
	normalizeTracks,
	normalizeBaseUrl,
	parseLyrics,
} from "../src/api.js";
const track = {
	mid: "mid-a",
	title: "晴天",
	singer: [{ mid: "jay", name: "周杰伦" }],
	album: { mid: "album", name: "叶惠美" },
	interval: 269,
	file: { media_mid: "media", size_128mp3: 100, size_320mp3: 200 },
	pay: { pay_play: 1 },
};
const reply = (value) => ({ ok: true, json: async () => value });
test("normalizes both legacy and current song formats; rejects unusable records and duplicates", () => {
	const value = normalizeTrack(track);
	assert.equal(value.id, "mid-a");
	assert.equal(value.mediaId, "media");
	assert.equal(value.vip, true);
	assert.equal(value.duration, 269);
	assert.deepEqual(value.qualities, ["320", "128"]);
	assert.match(value.coverUrl, /album/);
	assert.equal(
		normalizeTrack({
			songmid: "old",
			songname: "旧歌",
			albummid: "oldalbum",
			singer: [],
		}).title,
		"旧歌",
	);
	assert.equal(normalizeTrack({ name: "no mid" }), null);
	assert.equal(normalizeTracks([track, { musicData: track }, {}]).length, 1);
});
test("artist searches use the verified smartbox singer results; blank queries load real popular singers", async () => {
	const urls = [];
	const api = new QQMusicProvider({
		fetcher: async (url) => {
			urls.push(url);
			return reply(
				url.includes("Smartbox")
					? {
							response: {
								code: 0,
								data: {
									singer: { itemlist: [{ mid: "jay", name: "周杰伦" }] },
								},
							},
						}
					: {
							response: {
								code: 0,
								singerList: {
									data: {
										singerlist: [
											{ singer_mid: "eason", singer_name: "陈奕迅" },
										],
									},
								},
							},
						},
			);
		},
	});
	assert.equal((await api.searchArtists(" 周杰伦 "))[0].id, "jay");
	assert.equal((await api.searchArtists(""))[0].name, "陈奕迅");
	assert.match(urls[0], /getSmartbox\?key=/);
	assert.match(urls[1], /getSingerList/);
});
test("radio catalogue, batch and singer songs map the actual upstream envelopes", async () => {
	const api = new QQMusicProvider({
		fetcher: async (url) =>
			reply({
				response: url.includes("RadioLists")
					? {
							data: {
								data: {
									groupList: [
										{
											name: "热门",
											radioList: [
												{ radioId: "99", radioName: "个性" },
												{ radioId: "199", radioName: "热歌" },
											],
										},
									],
								},
							},
						}
					: url.includes("RadioTracks")
						? { radio: { code: 0, data: { track_list: [track] } } }
						: { singer: { code: 0, data: { songlist: [track] } } },
			}),
	});
	assert.deepEqual(
		(await api.getRadioStations()).map((s) => s.id),
		["199"],
	);
	assert.equal((await api.getRadioTracks("199"))[0].title, "晴天");
	assert.equal((await api.getArtistTracks("jay"))[0].id, "mid-a");
});
test("playback starts with the highest advertised quality; empty or unsafe URLs never play", async () => {
	let lastUrl;
	const api = new QQMusicProvider({
		fetcher: async (url) => {
			lastUrl = url;
			return reply({
				data: {
					playUrl: { "mid-a": { url: "http://audio.qqmusic.qq.com/file.mp3" } },
				},
			});
		},
	});
	assert.equal(
		await api.getPlayback(normalizeTrack(track)),
		"https://audio.qqmusic.qq.com/file.mp3",
	);
	assert.match(lastUrl, /mediaId=media&quality=320/);
	for (const url of ["", "javascript:alert(1)"]) {
		api.fetcher = async () =>
			reply({ data: { playUrl: { "mid-a": { url } } } });
		await assert.rejects(api.getPlayback(normalizeTrack(track)), /播放权限/);
	}
});
test("HTTP errors, upstream business errors, timeouts and bad server URLs are actionable", async () => {
	for (const baseUrl of [
		"javascript:abc",
		"file:///etc/passwd",
		"https://user:password@example.org",
	])
		assert.throws(() => normalizeBaseUrl(baseUrl));
	assert.equal(
		normalizeBaseUrl(" http://localhost:3200/ "),
		"http://localhost:3200",
	);
	const api = new QQMusicProvider({
		fetcher: async () => ({ ok: false, status: 502 }),
	});
	await assert.rejects(api.checkConnection(), /无法连接/);
	api.fetcher = async () => reply({ response: { code: 1000 } });
	await assert.rejects(api.getRecommendedTracks(), /暂时无法/);
	api.fetcher = async (_url, options) => {
		await new Promise((resolve) => setTimeout(resolve, 5));
		options.signal.throwIfAborted();
	};
	api.timeout = 1;
	await assert.rejects(api.checkConnection(), /超时/);
});
test("LRC supports multiple timestamps, milliseconds, metadata and offsets", () => {
	assert.deepEqual(
		parseLyrics(
			"[ti:晴天]\n[offset:100]\n[00:01.234][00:02.5]一句歌词\n[00:03]另一句",
		),
		[
			{ time: 1.134, text: "一句歌词" },
			{ time: 2.4, text: "一句歌词" },
			{ time: 2.9, text: "另一句" },
		],
	);
	assert.deepEqual(parseLyrics("pure music"), []);
});
test("native fetch is bound to its global receiver", async () => {
	const api = new QQMusicProvider({
		fetcher: async function () {
			assert.equal(this, globalThis);
			return reply({ response: { code: 0 } });
		},
	});
	await api.checkConnection();
});

test("FLAC is preferred and unavailable high qualities fall back without retrying unsupported formats", async () => {
	const attempted = [];
	const api = new QQMusicProvider({
		fetcher: async (rawUrl) => {
			const quality = new URL(rawUrl, "http://localhost").searchParams.get(
				"quality",
			);
			attempted.push(quality);
			return reply({
				data: {
					playUrl: {
						"mid-a": {
							url:
								quality === "128"
									? "https://audio.qqmusic.qq.com/song.mp3"
									: "",
						},
					},
				},
			});
		},
	});
	const song = normalizeTrack({
		...track,
		file: {
			media_mid: "media",
			size_flac: 500,
			size_128mp3: 100,
			size_96aac: 50,
		},
	});
	assert.equal(
		await api.getPlayback(song),
		"https://audio.qqmusic.qq.com/song.mp3",
	);
	assert.deepEqual(attempted, ["flac", "128"]);
	attempted.length = 0;
	api.fetcher = async (rawUrl) => {
		attempted.push(
			new URL(rawUrl, "http://localhost").searchParams.get("quality"),
		);
		return reply({
			data: {
				playUrl: { "mid-a": { url: "https://audio.qqmusic.qq.com/song.flac" } },
			},
		});
	};
	await api.getPlayback(song);
	assert.deepEqual(attempted, ["flac"]);
});

test("legacy tracks probe qualities in descending order and browser support constrains selection", async () => {
	const attempted = [];
	const api = new QQMusicProvider({
		supportedQualities: ["320", "128", "m4a"],
		fetcher: async (rawUrl) => {
			const quality = new URL(rawUrl, "http://localhost").searchParams.get(
				"quality",
			);
			attempted.push(quality);
			return reply({
				data: {
					playUrl: {
						"mid-a": {
							url:
								quality === "m4a"
									? "https://audio.qqmusic.qq.com/song.m4a"
									: "",
						},
					},
				},
			});
		},
	});
	await api.getPlayback({ id: "mid-a", mediaId: "media" });
	assert.deepEqual(attempted, ["320", "128", "m4a"]);
});

test("network failures do not trigger lower-quality requests and cancellation stops probing", async () => {
	let calls = 0;
	const api = new QQMusicProvider({
		fetcher: async () => {
			calls++;
			return { ok: false, status: 502 };
		},
	});
	await assert.rejects(api.getPlayback({ id: "mid-a" }), /无法连接/);
	assert.equal(calls, 1);
	calls = 0;
	const controller = new AbortController();
	api.fetcher = async () => {
		calls++;
		controller.abort();
		return reply({ data: { playUrl: {} } });
	};
	await assert.rejects(
		api.getPlayback({ id: "mid-a" }, { signal: controller.signal }),
		{ name: "AbortError" },
	);
	assert.equal(calls, 1);
});
