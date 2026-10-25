import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { PlayerSession, formatTime, orderLabels } from "../src/player.js";
import { AudioTransport } from "../src/audio.js";
import { rememberArtist } from "../src/storage.js";

const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8")
	.replace(/^import .*;\n/gm, "");
const songs = ["a", "b", "c"].map((id) => ({ id, title: id, duration: 200 }));

function app(preferences = {}, { mobile = false, desktop = false } = {}) {
	const elements = new Map();
	const media = new EventTarget();
	media.matches = mobile;
	const playbackRequests = [];
	const saved = [];
	const element = (selector) => {
		if (!elements.has(selector)) {
			const node = new EventTarget();
			const attributes = new Map();
			const classes = new Set();
			Object.assign(node, {
				hidden: true, dataset: {}, offsetTop: 0,
				innerHTML: "", scrollTop: 0,
				insertAdjacentHTML(_position, value) { this.innerHTML += value; },
				style: { setProperty() {}, removeProperty() {} },
				classList: {
					toggle(name, on = !classes.has(name)) { if (on) classes.add(name); else classes.delete(name); },
					add(name) { classes.add(name); }, contains(name) { return classes.has(name); },
				},
				setAttribute: (name, value) => attributes.set(name, value),
				getAttribute: (name) => attributes.get(name),
				removeAttribute: (name) => attributes.delete(name),
				contains: () => false, querySelector: () => null,
				focus() { document.activeElement = node; },
				blur() { if (document.activeElement === node) document.activeElement = null; },
				append(child) { child.parentElement = node; },
			});
			elements.set(selector, node);
		}
		return elements.get(selector);
	};
	const modes = ["home", "radio", "liked", "artist"].map((mode) => {
		const node = element(`[data-mode="${mode}"]`);
		node.dataset.mode = mode;
		return node;
	});
	const document = Object.assign(new EventTarget(), {
		querySelector: (selector) => selector === '.mode-option[aria-checked="true"]'
			? modes.find((node) => node.getAttribute("aria-checked") === "true") || null
			: selector === ".mode-option" ? modes[0] : element(selector),
		querySelectorAll: (selector) => selector === ".mode-option" ? modes : [],
		body: element("body"), documentElement: element("html"),
	});
	const window = Object.assign(new EventTarget(), {
		matchMedia: () => media,
		...(desktop && { interludeDesktop: { minimize() {}, close() {} } }),
	});
	class Audio extends EventTarget {
		paused = true;
		ended = false;
		readyState = 1;
		currentTime = 0;
		duration = 200;
		loads = 0;
		canPlayType() { return "probably"; }
		load() { this.loads++; this.currentTime = 0; }
		removeAttribute() { this.src = ""; }
		pause() { this.paused = true; this.dispatchEvent(new Event("pause")); }
		async play() { this.paused = false; this.dispatchEvent(new Event("playing")); }
	}
	const context = vm.createContext({
		document, window, navigator: {},
		Audio, AudioTransport, PlayerSession, formatTime, orderLabels, AbortController, rememberArtist,
		icon: () => "", artworkUrl: (url) => url || "",
		readLibrary: () => ({
			queue: [], liked: [], order: "repeat", hasQueue: false,
			queueSource: { type: "radio", resource: { id: "new", name: "每日新歌" } }, ...preferences,
		}),
		writeLibrary: (value) => { saved.push(structuredClone(value)); return true; },
		Authentication: class { start() {} },
		FavoriteSync: class {
			constructor({ onChange }) { this.onChange = onChange; this.tracks = songs; this.busy = new Set(); }
			async sync() { this.onChange(this.tracks); }
			async set(track, liked) {
				this.tracks = this.tracks.filter((item) => item.id !== track.id);
				if (liked) this.tracks.push(track);
				this.onChange(this.tracks);
				return true;
			}
		},
		QQMusicProvider: class {
			async getPlayback(track) { playbackRequests.push(track.id); return `https://music.test/${track.id}`; }
			async getRadioStations() { return []; }
			async getRecommendedTracks() { return [{ id: "radio", title: "radio", duration: 200 }]; }
			async getRadioTracks() { return songs; }
			async getArtistTracks() { return songs; }
			async getArtistTrackPage(id, page) { return { tracks: await this.getArtistTracks(id, page), hasMore: false }; }
			async getAlbumTrackPage() { return { tracks: songs, hasMore: false }; }
			async getArtistAlbums() { return { albums: [{ id: "album", name: "专辑" }], hasMore: false }; }
			async getAuthStatus() { return { authenticated: true, user: { uin: "100" } }; }
			async getLyrics() { return []; }
			async searchArtists() { return []; }
		},
		IntersectionObserver: class { disconnect() {} observe() {} },
		setInterval() {}, setTimeout, clearTimeout,
	});
	vm.runInContext(source, context);
	vm.runInContext('authReady = true; activeUser = { uin: "100" }', context);
	const state = vm.runInContext("({ session, transport, audio, liked, favorites, switchSource, showRadio, showSearch, renderArtists, showArtistAlbums, loadMoreAlbums, renderQueue, setView, loadMore, advance, startPlayer, refreshFavorites, showLyrics, returnToPlayer })", context);
	for (const song of songs) state.liked.set(song.id, song);
	const click = (selector, dataset) => {
		const event = new Event("click");
		if (dataset) Object.defineProperty(event, "target", { value: {
			closest: (query) => [...query.matchAll(/\[data-([\w-]+)\]/g)].some(([, attribute]) =>
				dataset[attribute.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] !== undefined)
				? { dataset } : null,
		} });
		element(selector).dispatchEvent(event);
	};
	return {
		...state, playbackRequests, saved, element, click, document, window, modes,
		resize(mobile) { media.matches = mobile; media.dispatchEvent(new Event("change")); },
		get view() { return vm.runInContext("view", context); },
		chooseMode(mode) { click("#mode-menu", { mode }); },
		chooseLiked() { click("#mode-menu", { mode: "liked" }); },
	};
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("returning to favorites preserves the current song, progress, queue and listening history", async () => {
	const player = app();
	await player.switchSource("liked", null);
	player.session.next();
	await player.transport.select(player.session.current, { autoplay: true });
	player.transport.seek(47);
	player.session.order = "shuffle";
	player.session.queue.pop(); // A manually edited queue must not be rebuilt on navigation.
	const queue = player.session.queue;
	const history = player.session.history;
	const loads = player.audio.loads;
	const requests = player.playbackRequests.length;

	for (const browse of [() => player.showRadio(), () => player.showSearch(), () => player.setView("lyrics")]) {
		await browse();
		assert.equal(player.audio.paused, false);
		player.chooseLiked();
		await settle();
		assert.equal(player.view, "liked");
		assert.equal(player.session.current.id, "b");
		assert.equal(player.session.elapsed, 47);
		assert.equal(player.audio.currentTime, 47);
		assert.equal(player.session.queue, queue);
		assert.equal(player.session.history, history);
		assert.equal(player.session.order, "shuffle");
		assert.equal(player.session.playing, true);
		assert.equal(player.audio.loads, loads);
		assert.equal(player.playbackRequests.length, requests);
	}
});

test("reselecting favorites preserves paused and buffering playback", async () => {
	const player = app();
	await player.switchSource("liked", null);
	await settle();
	player.transport.seek(23);
	player.transport.pause();
	const loads = player.audio.loads;
	player.chooseLiked();
	await settle();
	assert.equal(player.audio.paused, true);
	assert.equal(player.transport.desiredPlaying, false);
	assert.equal(player.session.elapsed, 23);
	assert.equal(player.audio.loads, loads);

	let resolvePlayback;
	player.transport.provider.getPlayback = () => new Promise((resolve) => { resolvePlayback = resolve; });
	const pending = player.transport.select(player.session.current, { autoplay: true, elapsed: 23 });
	const version = player.transport.version;
	player.chooseLiked();
	assert.equal(player.transport.version, version);
	assert.equal(player.transport.desiredPlaying, true);
	assert.equal(player.transport.loading, true);
	resolvePlayback("https://music.test/a");
	await pending;
	assert.equal(player.audio.paused, false);
	assert.equal(player.transport.pendingSeek, 23);
});

test("browsing favorites preserves a different source until explicit playback, including after clear", async () => {
	const player = app();
	await player.switchSource("liked", null);
	player.transport.seek(31);
	await player.switchSource("radio", { id: "new", name: "每日新歌" });
	await settle();
	assert.equal(player.session.current.id, "radio");
	assert.equal(player.session.elapsed, 0);
	player.chooseLiked();
	await settle();
	assert.equal(player.session.current.id, "radio");
	player.click("#play-liked");
	await settle();
	assert.equal(player.session.current.id, "a");
	assert.equal(player.session.elapsed, 0);
	assert.equal(player.audio.paused, false);

	player.click("#clear-queue");
	player.chooseLiked();
	await settle();
	assert.equal(player.session.current, null);
	player.click("#play-liked");
	await settle();
	assert.equal(player.session.queue.length, 3);
	assert.equal(player.session.current.id, "a");
});

test("returning to favorites cancels a pending playlist change", async () => {
	const player = app();
	await player.switchSource("liked", null);
	await settle();
	player.transport.seek(41);
	let resolveTracks;
	player.transport.provider.getRecommendedTracks = () => new Promise((resolve) => { resolveTracks = resolve; });
	const pending = player.switchSource("radio", { id: "new" });
	player.chooseLiked();
	resolveTracks([{ id: "other", title: "other" }]);
	await pending;
	assert.equal(player.session.current.id, "a");
	assert.equal(player.session.elapsed, 41);
	assert.equal(player.audio.paused, false);
});

for (const type of ["artist", "radio", "liked"]) {
	for (const playbackState of ["playing", "paused", "buffering"]) {
		test(`browsing every page preserves the ${type} queue while ${playbackState}`, async () => {
			const player = app();
			await player.switchSource(type, type === "liked" ? null : { id: type === "artist" ? "singer" : "42" });
			player.session.next();
			await player.transport.select(player.session.current, { autoplay: true });
			player.transport.seek(47);
			player.session.order = "shuffle";
			player.session.queue.pop();
			const queue = player.session.queue, history = player.session.history, queueSource = player.session.source;
			let resolvePlayback, pending;
			if (playbackState === "paused") player.transport.pause();
			if (playbackState === "buffering") {
				player.transport.provider.getPlayback = () => new Promise((resolve) => { resolvePlayback = resolve; });
				pending = player.transport.select(player.session.current, { autoplay: true, elapsed: 47 });
			}
			const loads = player.audio.loads, version = player.transport.version, requests = player.playbackRequests.length;
			for (const [mode, view] of [["liked", "liked"], ["artist", "search"], ["radio", "browse"]]) {
				player.chooseMode(mode);
				await settle();
				assert.equal(player.view, view);
				player.chooseMode("home");
				assert.equal(player.view, "player");
				assert.equal(player.element("#mode-toggle").getAttribute("aria-label"), "切换页面：主页");
				player.showLyrics();
				await settle();
				player.chooseMode("home");
				assert.equal(player.view, "player");
				assert.equal(player.session.current.id, "b");
				assert.equal(player.session.elapsed, 47);
				assert.equal(player.session.queue, queue);
				assert.equal(player.session.source, queueSource);
				assert.equal(player.session.history, history);
				assert.equal(player.session.order, "shuffle");
				assert.equal(player.audio.loads, loads);
				assert.equal(player.transport.version, version);
				assert.equal(player.playbackRequests.length, requests);
				assert.equal(player.transport.desiredPlaying, playbackState !== "paused");
				assert.equal(player.audio.paused, playbackState !== "playing");
				if (playbackState !== "buffering") assert.equal(player.audio.currentTime, 47);
			}
			if (pending) {
				assert.equal(player.transport.loading, true);
				resolvePlayback("https://music.test/b");
				await pending;
				assert.equal(player.audio.paused, false);
				assert.equal(player.transport.pendingSeek, 47);
			}
		});
	}
}

test("choosing a favorite song explicitly replaces the queue and starts from that song", async () => {
	const player = app();
	await player.switchSource("radio", { id: "new" });
	player.chooseLiked();
	player.click("#liked-results", { likedTrack: "c" });
	await settle();
	assert.equal(player.view, "player");
	assert.equal(player.session.current.id, "c");
	assert.equal(player.session.queue.length, 3);
	assert.equal(player.session.source.type, "liked");
	assert.equal(player.audio.paused, false);
});

test("an empty favorites page never replaces the existing playback queue", async () => {
	const player = app();
	await player.switchSource("artist", { id: "singer" });
	player.transport.seek(31);
	player.liked.clear();
	player.chooseLiked();
	assert.equal(player.element("#play-liked").disabled, true);
	await player.switchSource("liked", null);
	assert.equal(player.session.current.id, "a");
	assert.equal(player.session.elapsed, 31);
	assert.equal(player.audio.paused, false);
});

test("automatic next and manual previous use the original queue on the favorites page", async () => {
	const player = app();
	await player.switchSource("artist", { id: "singer" });
	player.liked.clear();
	player.chooseLiked();
	player.audio.dispatchEvent(new Event("ended"));
	await settle();
	assert.equal(player.view, "liked");
	assert.equal(player.session.current.id, "b");
	player.click("#previous-track");
	await settle();
	assert.equal(player.session.current.id, "a");
});

test("radio completion and pagination survive navigation while waiting for the next batch", async () => {
	const player = app();
	await player.switchSource("radio", { id: "42", name: "电台" });
	player.session.select(2);
	let resolveTracks;
	player.transport.provider.getRadioTracks = (id, firstplay) => {
		assert.equal(id, "42");
		assert.equal(firstplay, 0);
		return new Promise((resolve) => { resolveTracks = resolve; });
	};
	const pending = player.advance("next", true);
	player.chooseLiked();
	resolveTracks([{ id: "next", title: "下一批" }]);
	await pending;
	await settle();
	assert.equal(player.view, "liked");
	assert.equal(player.session.current.id, "next");
	assert.equal(player.session.queue.length, 4);
	assert.equal(player.audio.paused, false);
});

test("artist pagination follows the queue source and ignores batches for replaced queues", async () => {
	const player = app();
	await player.switchSource("artist", { id: "singer" });
	let resolveTracks, expectedPage = 2;
	player.session.source.hasMore = true;
	player.transport.provider.getArtistTrackPage = (id, page) => {
		assert.equal(id, "singer");
		assert.equal(page, expectedPage);
		return new Promise((resolve) => { resolveTracks = resolve; });
	};
	const pending = player.loadMore();
	player.chooseLiked();
	resolveTracks({ tracks: [{ id: "page2", title: "第二页" }], hasMore: true });
	assert.equal(await pending, true);
	assert.equal(player.session.source.page, 2);
	assert.equal(player.session.queue.length, 4);
	expectedPage = 3;
	const stale = player.loadMore();
	await player.switchSource("liked", null);
	resolveTracks({ tracks: [{ id: "stale", title: "旧请求" }], hasMore: false });
	assert.equal(await stale, false);
	assert.equal(player.session.queue.length, 3);
	assert.equal(player.session.current.id, "a");
});

test("a new queue can fetch while an old batch is pending, and clear discards its batch", async () => {
	const player = app();
	await player.switchSource("radio", { id: "new" });
	let resolveOld, resolveNew;
	player.transport.provider.getRecommendedTracks = () => new Promise((resolve) => { resolveOld = resolve; });
	const oldBatch = player.loadMore();
	await player.switchSource("artist", { id: "singer" });
	player.session.source.hasMore = true;
	player.transport.provider.getArtistTrackPage = () => new Promise((resolve) => { resolveNew = resolve; });
	const newBatch = player.loadMore();
	assert.equal(typeof resolveNew, "function");
	resolveOld([{ id: "stale", title: "旧请求" }]);
	assert.equal(await oldBatch, false);
	player.click("#clear-queue");
	resolveNew({ tracks: [{ id: "cleared", title: "已清空" }], hasMore: false });
	assert.equal(await newBatch, false);
	assert.equal(player.session.current, null);
	assert.equal(player.audio.paused, true);
});

test("favorite sync and unliking update the library without changing playback or queue edits", async () => {
	const player = app();
	await player.switchSource("liked", null);
	player.session.next();
	await player.transport.select(player.session.current, { autoplay: true });
	player.transport.seek(53);
	player.session.queue.pop();
	const queue = player.session.queue, history = player.session.history, loads = player.audio.loads;
	player.favorites.tracks = [songs[1], { id: "new-favorite", title: "new" }];
	player.chooseLiked();
	await player.refreshFavorites();
	assert.match(player.element("#liked-results").innerHTML, /new-favorite/);
	player.click("#like-toggle");
	await settle();
	assert.equal(player.liked.has("b"), false);
	assert.doesNotMatch(player.element("#liked-results").innerHTML, /data-liked-track="b"/);
	assert.equal(player.session.queue, queue);
	assert.equal(player.session.history, history);
	assert.equal(player.session.current.id, "b");
	assert.equal(player.session.elapsed, 53);
	assert.equal(player.audio.currentTime, 53);
	assert.equal(player.audio.loads, loads);
	assert.equal(player.audio.paused, false);
});

test("restart restores the edited queue independently of the latest cloud favorites", () => {
	const player = app({
		hasQueue: true, queue: [songs[2], songs[0]], currentId: "a", elapsed: 42,
		queueSource: { type: "liked" },
	});
	player.liked.clear();
	player.liked.set("other", { id: "other", title: "other" });
	player.startPlayer();
	assert.deepEqual(player.session.queue.map((track) => track.id), ["c", "a"]);
	assert.equal(player.session.current.id, "a");
	assert.equal(player.session.elapsed, 42);
	assert.equal(player.audio.paused, true);
	assert.equal(player.transport.pendingSeek, 42);
	assert.equal(player.saved.at(-1).queueSource.type, "liked");
});

test("restart preserves an explicitly cleared queue instead of fetching a new playlist", async () => {
	const player = app({ hasQueue: true, queue: [], queueSource: null });
	player.transport.provider.getRecommendedTracks = () => assert.fail("must not replace a saved empty queue");
	player.startPlayer();
	await settle();
	assert.equal(player.session.current, null);
	assert.equal(player.transport.track, null);
});

test("search starts with saved artist rows, switches on search, and clearing restores history despite late results", async () => {
	const history = [{ id: "recent", name: "最近听过", avatarUrl: "cover" }];
	const player = app({ artistHistory: history });
	let searchCalls = 0, finish;
	player.transport.provider.searchArtists = () => { searchCalls++; return new Promise((resolve) => { finish = resolve; }); };
	player.showSearch();
	assert.equal(searchCalls, 0);
	assert.match(player.element("#artist-results").innerHTML, /data-artist="recent"/);
	const pending = player.renderArtists("搜索");
	finish([{ id: "found", name: "搜索到的歌手" }]);
	await pending;
	assert.match(player.element("#artist-results").innerHTML, /data-artist="found"/);
	const stale = player.renderArtists("旧搜索");
	player.element("#search-input").value = "";
	player.element("#search-input").dispatchEvent(new Event("input"));
	finish([{ id: "stale", name: "过期结果" }]);
	await stale;
	assert.match(player.element("#artist-results").innerHTML, /data-artist="recent"/);
	assert.doesNotMatch(player.element("#artist-results").innerHTML, /stale/);
	assert.equal(player.element("#search-empty").hidden, true);
});

test("clicking a singer opens albums and records history while preserving playback, and only clicking an album replaces it", async () => {
	const player = app({ artistHistory: [{ id: "old", name: "以前听过" }] });
	await player.switchSource("radio", { id: "new" });
	player.transport.seek(42);
	const queue = player.session.queue, loads = player.audio.loads;
	player.showSearch();
	player.transport.provider.searchArtists = async () => [{ id: "singer", name: "歌手", avatarUrl: "avatar" }];
	await player.renderArtists("歌手");
	player.click("#artist-results", { artist: "singer" });
	await settle();
	assert.equal(player.view, "albums");
	assert.equal(player.element("#artist-summary-name").textContent, "歌手");
	assert.equal(player.element("#artist-summary-image").src, "avatar");
	assert.equal(player.session.queue, queue);
	assert.equal(player.audio.loads, loads);
	assert.equal(player.session.elapsed, 42);
	assert.equal(player.audio.paused, false);
	assert.deepEqual(player.saved.at(-1).artistHistory.map((artist) => artist.id), ["singer", "old"]);
	assert.match(player.element("#album-results").innerHTML, /data-album="album"/);
	player.transport.provider.getAlbumTrackPage = async (id) => {
		assert.equal(id, "album");
		return { tracks: [{ id: "album-song", title: "专辑歌曲" }], hasMore: false };
	};
	player.click("#album-results", { album: "album" });
	await settle();
	assert.equal(player.session.source.type, "album");
	assert.equal(player.session.current.id, "album-song");
	assert.equal(player.audio.paused, false);
});

test("the artist header play button requests the singer's catalogue rather than an album", async () => {
	const player = app();
	await player.showArtistAlbums({ id: "singer", name: "歌手" });
	player.transport.provider.getAlbumTrackPage = () => assert.fail("header must not request an album");
	player.transport.provider.getArtistTrackPage = async (id, page) => {
		assert.equal(id, "singer"); assert.equal(page, 1);
		return { tracks: songs, hasMore: false };
	};
	player.click("#play-artist");
	await settle();
	assert.equal(player.session.source.type, "artist");
	assert.equal(player.session.current.id, "a");
	assert.equal(player.audio.paused, false);
});

test("album browsing loads further pages once per scroll and cancels stale responses when leaving", async () => {
	const player = app();
	let calls = 0, finish, signal;
	player.transport.provider.getArtistAlbums = async (id, page, options) => {
		calls++; signal = options.signal;
		if (page === 1) return { albums: [{ id: "album1", name: "第一张" }], hasMore: true };
		return new Promise((resolve) => { finish = resolve; });
	};
	await player.showArtistAlbums({ id: "singer", name: "歌手" });
	Object.assign(player.element("#album-results"), { scrollHeight: 500, clientHeight: 400, scrollTop: 50 });
	player.element("#album-results").dispatchEvent(new Event("scroll"));
	player.element("#album-results").dispatchEvent(new Event("scroll"));
	assert.equal(calls, 2);
	player.showSearch();
	assert.equal(signal.aborted, true);
	finish({ albums: [{ id: "stale", name: "过期专辑" }], hasMore: false });
	await settle();
	assert.doesNotMatch(player.element("#album-results").innerHTML, /stale/);
	assert.equal(player.view, "search");
});

for (const type of ["artist", "album"]) {
	test(`${type} playback loads beyond 1000 songs, merges concurrent requests and stops at the final page`, async () => {
		const player = app();
		const queue = Array.from({ length: 1000 }, (_, index) => ({ id: `song${index}`, title: `歌曲${index}` }));
		player.session.setQueue(queue, { source: { type, resource: { id: "mid" }, page: 20, hasMore: true } });
		player.session.select(999);
		let calls = 0, finish;
		player.transport.provider[type === "artist" ? "getArtistTrackPage" : "getAlbumTrackPage"] = (id, page) => {
			assert.equal(id, "mid"); assert.equal(page, 21); calls++;
			return new Promise((resolve) => { finish = resolve; });
		};
		const pending = player.advance("next");
		const duplicate = player.loadMore();
		assert.equal(calls, 1);
		finish({ tracks: [{ id: "song999", title: "重复" }, { id: "song1000", title: "第1001首" }], hasMore: false });
		await Promise.all([pending, duplicate]);
		await settle();
		assert.equal(player.session.queue.length, 1001);
		assert.equal(player.session.current.id, "song1000");
		assert.equal(player.session.source.page, 21);
		assert.equal(player.session.source.hasMore, false);
		assert.equal(player.audio.paused, false);
		assert.equal(await player.loadMore(), false);
		assert.equal(calls, 1);
		await player.advance("next");
		assert.equal(player.session.current.id, "song0");
	});
}

test("artist playback prefetches one page near the tail without interrupting the current audio", async () => {
	const player = app();
	const tracks = Array.from({ length: 50 }, (_, i) => ({ id: `track${i}`, title: `歌曲${i}` }));
	let pages = [];
	player.transport.provider.getArtistTrackPage = async (_id, page) => {
		pages.push(page);
		return page === 1 ? { tracks, hasMore: true } : { tracks: [{ id: "next", title: "下一页" }], hasMore: false };
	};
	await player.switchSource("artist", { id: "singer" });
	await settle();
	assert.deepEqual(pages, [1]);
	player.session.select(43);
	await player.advance("next");
	await settle();
	assert.deepEqual(pages, [1, 2]);
	assert.equal(player.session.current.id, "track44");
	assert.equal(player.session.queue.length, 51);
	assert.equal(player.audio.paused, false);
});

test("failed catalogue pages retain their cursor and current song until a retry succeeds", async () => {
	const player = app();
	player.session.setQueue(songs, { source: { type: "artist", resource: { id: "singer" }, page: 1, hasMore: true } });
	player.session.select(2);
	player.transport.provider.getArtistTrackPage = async () => { throw new Error("暂时无法连接"); };
	await player.advance("next", true);
	assert.equal(player.session.current.id, "c");
	assert.equal(player.session.source.page, 1);
	player.transport.provider.getArtistTrackPage = async () => ({ tracks: [{ id: "next", title: "下一首" }], hasMore: false });
	await player.advance("next", true);
	assert.equal(player.session.current.id, "next");
	assert.equal(player.session.source.page, 2);
});

test("long queues render only a bounded window and keep original song indices after scrolling", () => {
	const player = app();
	player.session.setQueue(Array.from({ length: 10000 }, (_, i) => ({ id: `track${i}`, title: `歌曲${i}` })));
	player.renderQueue();
	assert.equal((player.element("#queue-list").innerHTML.match(/data-index=/g) || []).length, 60);
	player.element("#queue-list").scrollTop = 70000;
	player.element("#queue-list").dispatchEvent(new Event("scroll"));
	assert.match(player.element("#queue-list").innerHTML, /data-index="1000"/);
	assert.doesNotMatch(player.element("#queue-list").innerHTML, /data-index="0"/);
	assert.equal(player.session.queue.length, 10000);
});

test("keyboard navigation reaches songs beyond the virtual queue window", () => {
	const player = app();
	player.session.setQueue(Array.from({ length: 10000 }, (_, i) => ({ id: `track${i}`, title: `歌曲${i}` })));
	player.element("#queue-list").clientHeight = 400;
	const event = new Event("keydown", { cancelable: true });
	Object.defineProperties(event, {
		key: { value: "End" },
		target: { value: { closest: () => ({ dataset: { index: "0" } }) } },
	});
	player.element("#queue-list").dispatchEvent(event);
	assert.equal(event.defaultPrevented, true);
	assert.match(player.element("#queue-list").innerHTML, /data-index="9999"/);
	assert.equal((player.element("#queue-list").innerHTML.match(/data-index=/g) || []).length, 60);
});

test("duplicate-only artist pages can advance to fresh songs without flooding the upstream", async () => {
	const player = app();
	player.session.setQueue(songs, { source: { type: "artist", resource: { id: "singer" }, page: 1, hasMore: true } });
	let calls = 0;
	player.transport.provider.getArtistTrackPage = async (_id, page) => {
		calls++;
		return { tracks: page === 2 ? songs : [{ id: "fresh", title: "新歌" }], hasMore: page === 2 };
	};
	assert.equal(await player.loadMore(), true);
	assert.equal(calls, 2);
	assert.equal(player.session.source.page, 3);
	assert.equal(player.session.queue.length, 4);
	player.session.source.hasMore = true;
	player.transport.provider.getArtistTrackPage = async () => { calls++; return { tracks: songs, hasMore: true }; };
	assert.equal(await player.loadMore(), false);
	assert.equal(calls, 5);
});

test("previous during a pending catalogue next prevents a late jump when the page arrives", async () => {
	const player = app();
	player.session.setQueue(songs, { source: { type: "artist", resource: { id: "singer" }, page: 1, hasMore: true } });
	player.session.select(2);
	let finish;
	player.transport.provider.getArtistTrackPage = () => new Promise((resolve) => { finish = resolve; });
	const next = player.advance("next");
	await player.advance("previous");
	finish({ tracks: [{ id: "fresh", title: "新歌" }], hasMore: false });
	await next;
	await settle();
	assert.equal(player.session.current.id, "a");
	assert.equal(player.session.queue.length, 4);
	assert.equal(player.audio.paused, false);
});

function dispatch(target, type, properties = {}) {
	const event = new Event(type, { cancelable: true });
	for (const [name, value] of Object.entries(properties))
		Object.defineProperty(event, name, { value });
	target.dispatchEvent(event);
	return event;
}
function pointer(player, type, x, y, properties = {}) {
	return dispatch(player.element(".main-stage"), type, {
		pointerId: 1, pointerType: "touch", isPrimary: true, clientX: x, clientY: y,
		target: { closest: () => null }, ...properties,
	});
}

test("opening the artist page leaves the search field unfocused", () => {
	const player = app({}, { mobile: true });
	player.showSearch();
	assert.equal(player.view, "search");
	assert.equal(player.document.activeElement, player.element("#mode-toggle"));
});

test("mobile queue is a normal page and keeps playback controls available", async () => {
	const player = app({}, { mobile: true });
	await player.switchSource("liked", null);
	player.transport.seek(47);
	const queue = player.session.queue, loads = player.audio.loads;
	player.chooseLiked();
	player.click("#queue-toggle");
	assert.equal(player.view, "queue");
	assert.equal(player.element("#liked-view").hidden, true);
	assert.equal(player.element("#queue-panel").hidden, false);
	assert.equal(player.element("#queue-panel").parentElement, player.element(".main-stage"));
	assert.equal(player.element("#queue-panel").getAttribute("role"), "region");
	assert.equal(player.element("#queue-panel").getAttribute("aria-modal"), undefined);
	assert.equal(player.element("#queue-backdrop").hidden, true);
	assert.equal(player.element(".player-footer").inert, false);
	assert.equal(player.element(".main-stage").inert, false);
	assert.equal(player.element(".topbar").inert, false);
	assert.equal(player.element("#queue-toggle").getAttribute("aria-expanded"), "true");
	assert.equal(player.session.queue, queue);
	assert.equal(player.audio.loads, loads);
	assert.equal(player.session.elapsed, 47);
	assert.equal(player.audio.paused, false);
	player.click("#queue-toggle");
	assert.equal(player.view, "player");
	assert.equal(player.element("#queue-panel").hidden, true);
	assert.equal(player.element("#queue-toggle").getAttribute("aria-expanded"), "false");
	player.click("#queue-toggle");
	player.chooseLiked();
	assert.equal(player.view, "liked");
	assert.equal(player.element("#queue-panel").hidden, true);
});

test("mobile queue selection, removal, and clear preserve page and playback semantics", async () => {
	const player = app({}, { mobile: true });
	await player.switchSource("liked", null);
	player.click("#queue-toggle");
	player.click("#queue-list", { remove: "2" });
	assert.equal(player.view, "queue");
	assert.equal(player.session.queue.length, 2);
	player.click("#queue-list", { index: "1" });
	await settle();
	assert.equal(player.view, "player");
	assert.equal(player.session.current.id, "b");
	assert.equal(player.audio.paused, false);
	player.click("#queue-toggle");
	player.click("#clear-queue");
	await settle();
	assert.equal(player.view, "queue");
	assert.equal(player.element("#queue-panel").hidden, false);
	assert.equal(player.session.current, null);
	assert.equal(player.audio.paused, true);
	assert.equal(player.document.activeElement, player.element("#queue-panel"));
});

test("responsive queue transitions keep the queue and progress while desktop retains its dialog", async () => {
	const player = app({}, { mobile: true });
	await player.switchSource("liked", null);
	player.transport.seek(39);
	player.transport.pause();
	const queue = player.session.queue, loads = player.audio.loads;
	player.click("#queue-toggle");
	player.resize(false);
	assert.equal(player.view, "player");
	assert.equal(player.element("#queue-panel").parentElement, player.element(".player"));
	assert.equal(player.element("#queue-panel").getAttribute("role"), "dialog");
	assert.equal(player.element("#queue-panel").getAttribute("aria-modal"), "true");
	assert.equal(player.element("#queue-backdrop").hidden, false);
	assert.equal(player.element(".player-footer").inert, true);
	player.resize(true);
	assert.equal(player.view, "queue");
	assert.equal(player.element(".player-footer").inert, false);
	assert.equal(player.element("#queue-backdrop").hidden, true);
	assert.equal(player.session.queue, queue);
	assert.equal(player.session.elapsed, 39);
	assert.equal(player.audio.loads, loads);
	assert.equal(player.audio.paused, true);
	const desktop = app({}, { mobile: true, desktop: true });
	desktop.click("#queue-toggle");
	assert.equal(desktop.view, "player");
	assert.equal(desktop.element("#queue-panel").getAttribute("role"), "dialog");
});

for (const view of ["liked", "search", "browse", "albums", "lyrics", "queue"]) {
	test(`mobile swipes return from ${view} and restore it without altering playback or selection`, async () => {
		const player = app({}, { mobile: true });
		await player.switchSource("liked", null);
		player.transport.seek(25);
		const queue = player.session.queue, loads = player.audio.loads;
		player.setView(view);
		const selectedMode = player.element("#mode-toggle").getAttribute("aria-label");
		pointer(player, "pointerdown", 20, 40);
		pointer(player, "pointermove", 120, 48);
		assert.equal(pointer(player, "pointerup", 160, 50).defaultPrevented, true);
		assert.equal(player.view, "player");
		assert.equal(player.session.queue, queue);
		assert.equal(player.session.elapsed, 25);
		assert.equal(player.audio.loads, loads);
		assert.equal(player.audio.paused, false);
		assert.equal(player.element("#queue-panel").hidden, true);
		assert.equal(dispatch(player.element(".main-stage"), "click").defaultPrevented, true);
		assert.equal(player.element("#mode-toggle").getAttribute("aria-label"), selectedMode);
		assert.notEqual(selectedMode, "切换页面：主页");
		pointer(player, "pointerdown", 180, 40);
		pointer(player, "pointermove", 80, 48);
		assert.equal(pointer(player, "pointerup", 20, 50).defaultPrevented, true);
		assert.equal(player.view, view);
		assert.equal(player.element("#mode-toggle").getAttribute("aria-label"), selectedMode);
		assert.equal(player.session.queue, queue);
		assert.equal(player.audio.loads, loads);
		assert.equal(player.session.elapsed, 25);
		assert.equal(player.audio.paused, false);
	});
}

test("vertical, short, leftward, cancelled and input gestures never navigate", () => {
	const player = app({}, { mobile: true });
	for (const [x, y] of [[50, 40], [-150, 40], [150, 160]]) {
		player.setView("liked");
		pointer(player, "pointerdown", 20, 40);
		pointer(player, "pointerup", x, y);
		assert.equal(player.view, "liked");
	}
	for (const interrupt of ["pointercancel", "pointermove"]) {
		pointer(player, "pointerdown", 20, 40);
		pointer(player, interrupt, 22, 100);
		pointer(player, "pointerup", 160, 40);
		assert.equal(player.view, "liked");
	}
	for (const properties of [{ isPrimary: false }, { pointerType: "mouse" }, { target: { closest: () => ({}) } }]) {
		pointer(player, "pointerdown", 20, 40, properties);
		pointer(player, "pointerup", 160, 40);
		assert.equal(player.view, "liked");
	}
});

test("expanded navigation blocks background controls and keyboard shortcuts until dismissed", async () => {
	const player = app({}, { mobile: true });
	await player.switchSource("liked", null);
	player.click("#queue-toggle");
	player.click("#mode-toggle");
	assert.equal(player.element("#mode-backdrop").hidden, false);
	assert.equal(player.element(".player").classList.contains("is-menu-open"), true);
	assert.equal(player.element(".player-footer").inert, true);
	assert.equal(player.element(".main-stage").inert, true);
	assert.equal(player.document.activeElement, player.modes[1]);
	dispatch(player.document, "keydown", { key: "Tab" });
	assert.equal(player.document.activeElement, player.modes[2]);
	const loads = player.audio.loads;
	dispatch(player.document, "keydown", { key: "ArrowRight", code: "ArrowRight" });
	assert.equal(player.audio.loads, loads);
	dispatch(player.document, "keydown", { key: "Escape" });
	assert.equal(player.view, "queue");
	assert.equal(player.element("#mode-backdrop").hidden, true);
	assert.equal(player.element(".player-footer").inert, false);
	player.click("#mode-toggle");
	player.click("#mode-backdrop");
	assert.equal(player.element(".main-stage").inert, false);
	assert.equal(player.document.activeElement, player.element("#mode-toggle"));
});

test("wheel pointer activation releases focus while keyboard activation keeps its focus indicator", () => {
	const player = app({}, { mobile: true });
	const button = player.element("#order-toggle");
	const target = { closest: () => button };
	button.focus();
	dispatch(player.element(".click-wheel"), "click", { detail: 1, target });
	assert.notEqual(player.document.activeElement, button);
	button.focus();
	dispatch(player.element(".click-wheel"), "click", { detail: 0, target });
	assert.equal(player.document.activeElement, button);
});

for (const options of [{ mobile: false }, { mobile: true, desktop: true }]) {
	test(`desktop interactions retain home navigation, search focus, and control focus ${JSON.stringify(options)}`, () => {
		const player = app({}, options);
		assert.equal(player.modes[0].hidden, false);
		player.showSearch();
		assert.equal(player.document.activeElement, player.element("#search-input"));
		player.click("#mode-toggle");
		assert.equal(player.element("#mode-backdrop").hidden, true);
		assert.equal(player.element(".player").classList.contains("is-menu-open"), false);
		assert.equal(!!player.element(".main-stage").inert, false);
		assert.equal(!!player.element(".player-footer").inert, false);
		player.chooseLiked();
		pointer(player, "pointerdown", 20, 40);
		pointer(player, "pointerup", 160, 40);
		assert.equal(player.view, "liked");
		player.chooseMode("home");
		assert.equal(player.view, "player");
		assert.equal(player.element("#mode-toggle").getAttribute("aria-label"), "切换页面：主页");
		pointer(player, "pointerdown", 180, 40);
		pointer(player, "pointerup", 20, 40);
		assert.equal(player.view, "player");
		const button = player.element("#order-toggle");
		button.focus();
		dispatch(player.element(".click-wheel"), "click", { detail: 1, target: { closest: () => button } });
		assert.equal(player.document.activeElement, button);
	});
}

test("mobile navigation keeps the selected page checked on the player and remembers the latest page", () => {
	const player = app({}, { mobile: true });
	assert.equal(player.modes[0].hidden, true);
	assert.notEqual(player.element("#mode-toggle").getAttribute("aria-label"), "切换页面：主页");
	// With no previous page, a leftward swipe on the player does nothing.
	pointer(player, "pointerdown", 180, 40);
	pointer(player, "pointerup", 20, 40);
	assert.equal(player.view, "player");
	for (const mode of ["liked", "artist"]) {
		player.chooseMode(mode);
		pointer(player, "pointerdown", 20, 40);
		pointer(player, "pointerup", 160, 40);
		assert.equal(player.view, "player");
		const option = player.modes.find((node) => node.dataset.mode === mode);
		assert.equal(option.getAttribute("aria-checked"), "true");
		assert.equal(player.modes[0].getAttribute("aria-checked"), "false");
		player.click("#mode-toggle");
		assert.equal(player.document.activeElement, option);
		player.click("#mode-backdrop");
		pointer(player, "pointerdown", 180, 40);
		pointer(player, "pointerup", 20, 40);
		assert.equal(player.view, mode === "liked" ? "liked" : "search");
	}
});

for (const playing of [false, true, "buffering"]) {
	test(`mobile round trips preserve playback and queue history while ${playing}`, async () => {
		const player = app({}, { mobile: true });
		await player.switchSource("liked", null);
		player.transport.seek(34);
		if (!playing) player.transport.pause();
		let finish, pending;
		if (playing === "buffering") {
			player.transport.provider.getPlayback = () => new Promise((resolve) => { finish = resolve; });
			pending = player.transport.select(player.session.current, { autoplay: true, elapsed: 34 });
		}
		const queue = player.session.queue, history = player.session.history, version = player.transport.version;
		player.chooseLiked();
		for (let round = 0; round < 3; round++) {
			pointer(player, "pointerdown", 20, 40);
			pointer(player, "pointerup", 160, 40);
			pointer(player, "pointerdown", 180, 40);
			pointer(player, "pointerup", 20, 40);
			assert.equal(player.view, "liked");
			assert.equal(player.session.queue, queue);
			assert.equal(player.session.history, history);
			assert.equal(player.session.elapsed, 34);
			assert.equal(player.transport.version, version);
			assert.equal(player.transport.desiredPlaying, !!playing);
		}
		if (pending) { finish("https://music.test/a"); await pending; }
	});
}

test("mobile search results and scroll survive swipes, including a response arriving on the player", async () => {
	const player = app({}, { mobile: true });
	player.showSearch();
	player.element("#search-input").value = "歌手";
	player.element("#artist-results").scrollTop = 140;
	let finish, signal;
	player.transport.provider.searchArtists = (_query, options) => {
		signal = options.signal;
		return new Promise((resolve) => { finish = resolve; });
	};
	const pending = player.renderArtists("歌手");
	pointer(player, "pointerdown", 20, 40);
	pointer(player, "pointerup", 160, 40);
	assert.equal(signal.aborted, false);
	finish([{ id: "found", name: "搜索到的歌手" }]);
	await pending;
	pointer(player, "pointerdown", 180, 40);
	pointer(player, "pointerup", 20, 40);
	assert.equal(player.view, "search");
	assert.equal(player.element("#search-input").value, "歌手");
	assert.equal(player.element("#artist-results").scrollTop, 140);
	assert.match(player.element("#artist-results").innerHTML, /data-artist="found"/);
	assert.notEqual(player.document.activeElement, player.element("#search-input"));
	const stale = player.renderArtists("旧搜索");
	player.returnToPlayer();
	player.chooseLiked();
	assert.equal(signal.aborted, true);
	finish([{ id: "stale", name: "过期结果" }]);
	await stale;
	assert.doesNotMatch(player.element("#artist-results").innerHTML, /data-artist="stale"/);
});

test("mobile album loading survives a trip to the player but is cancelled by choosing another page", async () => {
	const player = app({}, { mobile: true });
	let finish, signal;
	player.transport.provider.getArtistAlbums = (_id, _page, options) => {
		signal = options.signal;
		return new Promise((resolve) => { finish = resolve; });
	};
	const pending = player.showArtistAlbums({ id: "singer", name: "歌手" });
	player.returnToPlayer();
	assert.equal(signal.aborted, false);
	finish({ albums: [{ id: "first", name: "第一张" }], hasMore: true });
	await pending;
	pointer(player, "pointerdown", 180, 40);
	pointer(player, "pointerup", 20, 40);
	assert.equal(player.view, "albums");
	assert.match(player.element("#album-results").innerHTML, /data-album="first"/);
	const next = player.loadMoreAlbums();
	player.returnToPlayer();
	player.chooseLiked();
	assert.equal(signal.aborted, true);
	finish({ albums: [{ id: "stale", name: "过期专辑" }], hasMore: false });
	await next;
	assert.doesNotMatch(player.element("#album-results").innerHTML, /data-album="stale"/);
});

test("mobile station loading completes while on the player and is available after swiping back", async () => {
	const player = app({}, { mobile: true });
	let finish;
	player.transport.provider.getRadioStations = () => new Promise((resolve) => { finish = resolve; });
	const pending = player.showRadio();
	player.returnToPlayer();
	finish([{ id: "42", name: "电台", group: "公共电台" }]);
	await pending;
	pointer(player, "pointerdown", 180, 40);
	pointer(player, "pointerup", 20, 40);
	assert.equal(player.view, "browse");
	assert.match(player.element("#radio-results").innerHTML, /data-station="42"/);
});

test("switching out of mobile layout releases every background element blocked by its menu", () => {
	const player = app({}, { mobile: true });
	player.chooseLiked();
	player.click("#mode-toggle");
	assert.equal(player.element("#notice").inert, true);
	player.resize(false);
	for (const selector of [".topbar", ".main-stage", ".player-footer", "#notice"])
		assert.equal(player.element(selector).inert, false);
	assert.equal(player.element("#mode-backdrop").hidden, true);
	assert.equal(player.modes[0].hidden, false);
});
