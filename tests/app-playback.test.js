import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { PlayerSession, formatTime, orderLabels } from "../src/player.js";
import { AudioTransport } from "../src/audio.js";

const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8")
	.replace(/^import .*;\n/gm, "");
const songs = ["a", "b", "c"].map((id) => ({ id, title: id, duration: 200 }));

function app() {
	const elements = new Map();
	const playbackRequests = [];
	const element = (selector) => {
		if (!elements.has(selector)) {
			const node = new EventTarget();
			const attributes = new Map();
			Object.assign(node, {
				hidden: true, dataset: {}, offsetTop: 0,
				style: { setProperty() {}, removeProperty() {} },
				classList: { toggle() {}, add() {} },
				setAttribute: (name, value) => attributes.set(name, value),
				getAttribute: (name) => attributes.get(name),
				contains: () => false,
				focus() { document.activeElement = node; },
			});
			elements.set(selector, node);
		}
		return elements.get(selector);
	};
	const document = {
		querySelector: element, querySelectorAll: () => [], addEventListener() {},
		body: element("body"), documentElement: element("html"),
	};
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
		document, window: { addEventListener() {} }, navigator: {},
		Audio, AudioTransport, PlayerSession, formatTime, orderLabels, AbortController,
		icon: () => "", artworkUrl: (url) => url || "",
		readLibrary: () => ({ volume: 65, mode: "radio", station: { id: "new", name: "每日新歌" } }),
		writeLibrary: () => true,
		Authentication: class { start() {} }, FavoriteSync: class {},
		QQMusicProvider: class {
			async getPlayback(track) { playbackRequests.push(track.id); return `https://music.test/${track.id}`; }
			async getRadioStations() { return []; }
			async getRecommendedTracks() { return [{ id: "radio", title: "radio", duration: 200 }]; }
			async searchArtists() { return []; }
		},
		IntersectionObserver: class { disconnect() {} observe() {} },
		setInterval() {}, clearTimeout() {},
	});
	vm.runInContext(source, context);
	const state = vm.runInContext("({ session, transport, audio, liked, switchSource, showRadio, showSearch, setView })", context);
	for (const song of songs) state.liked.set(song.id, song);
	return {
		...state, playbackRequests,
		get view() { return vm.runInContext("view", context); },
		chooseLiked() {
			const event = new Event("click");
			Object.defineProperty(event, "target", {
				value: { closest: () => ({ dataset: { mode: "liked" } }) },
			});
			element("#mode-menu").dispatchEvent(event);
		},
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
		assert.equal(player.view, "player");
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

test("playing a different source starts its queue, and an empty favorites queue can be started again", async () => {
	const player = app();
	await player.switchSource("liked", null);
	player.transport.seek(31);
	await player.switchSource("radio", { id: "new", name: "每日新歌" });
	await settle();
	assert.equal(player.session.current.id, "radio");
	assert.equal(player.session.elapsed, 0);
	player.chooseLiked();
	await settle();
	assert.equal(player.session.current.id, "a");
	assert.equal(player.session.elapsed, 0);
	assert.equal(player.audio.paused, false);

	player.session.setQueue([]);
	player.chooseLiked();
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
