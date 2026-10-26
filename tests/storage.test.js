import test from "node:test";
import assert from "node:assert/strict";
import { readLibrary, writeLibrary, rememberArtist } from "../src/storage.js";
const memory = () => ({
	value: null,
	getItem() {
		return this.value;
	},
	setItem(_key, value) {
		this.value = value;
	},
});
test("restores the previous library after renaming and prefers subsequent qmplay saves", () => {
	const legacy = JSON.stringify({
		queue: [{ id: "saved-song", title: "上次播放" }], liked: [],
		currentId: "saved-song", elapsed: 42,
	});
	const values = new Map([["interlude-library-v2", legacy]]);
	const storage = {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
	};
	const restored = readLibrary(storage);
	assert.equal(restored.currentId, "saved-song");
	assert.equal(restored.queue[0].title, "上次播放");
	assert.equal(restored.elapsed, 42);
	assert.equal(writeLibrary({ ...restored, elapsed: 50 }, storage), true);
	assert.equal(JSON.parse(values.get("qmplay-library-v2")).elapsed, 50);
	assert.equal(readLibrary(storage).elapsed, 50);
	assert.equal(values.get("interlude-library-v2"), legacy);
});
test("persists full liked records, queue and selected song without signed playback URLs", () => {
	const storage = memory();
	const track = {
		id: "abc",
		title: "音乐",
		url: "secret",
		playbackUrl: "secret",
	};
	assert.equal(
		writeLibrary(
			{
				liked: [track],
				queue: [track],
				currentId: "abc",
				elapsed: 15,
				volume: 30,
			},
			storage,
		),
		true,
	);
	const restored = readLibrary(storage);
	assert.equal(restored.liked[0].title, "音乐");
	assert.equal(restored.queue[0].id, "abc");
	assert.equal(restored.elapsed, 15);
	assert.equal(storage.value.includes("secret"), false);
});
test("corrupt or unavailable storage never prevents launching; legacy demo ids are not imported", () => {
	const storage = memory();
	storage.value = "broken";
	assert.deepEqual(readLibrary(storage).queue, []);
	storage.value = JSON.stringify({
		liked: [null, {}, "travel"],
		queue: [],
		volume: 999,
	});
	assert.deepEqual(readLibrary(storage).liked, []);
	assert.equal("volume" in readLibrary(storage), false);
	assert.equal(
		writeLibrary(
			{ liked: [], queue: [] },
			{
				setItem() {
					throw Error("full");
				},
			},
		),
		false,
	);
});

test("legacy server, quality and volume settings are ignored and removed on save without losing the library", () => {
	const storage = memory();
	const song = { id: "favorite", title: "喜欢的歌" };
	storage.value = JSON.stringify({
		liked: [song],
		queue: [song],
		baseUrl: "https://old-server.example",
		quality: "128",
		volume: 0,
	});
	const restored = readLibrary(storage);
	assert.equal("baseUrl" in restored, false);
	assert.equal("quality" in restored, false);
	assert.equal(restored.liked[0].id, "favorite");
	assert.equal("volume" in restored, false);
	writeLibrary(
		{ ...restored, baseUrl: "https://old-server.example", quality: "128", volume: 0 },
		storage,
	);
	const saved = JSON.parse(storage.value);
	assert.equal("baseUrl" in saved, false);
	assert.equal("quality" in saved, false);
	assert.equal("volume" in saved, false);
	assert.equal(saved.queue[0].id, "favorite");
});

test("queue source and artist pagination round-trip independently of legacy navigation settings", () => {
	const storage = memory();
	const queueSource = { type: "artist", resource: { id: "singer", name: "歌手" }, page: 4 };
	writeLibrary({ liked: [], queue: [], queueSource, mode: "liked" }, storage);
	assert.deepEqual(readLibrary(storage).queueSource, queueSource);
	assert.equal(readLibrary(storage).hasQueue, true);
	writeLibrary({ liked: [], queue: [], queueSource: null }, storage);
	assert.equal(readLibrary(storage).queueSource, null);
	assert.equal(readLibrary(storage).hasQueue, true);
});

test("legacy queue sources migrate with their saved songs, and invalid pagination is reset", () => {
	const storage = memory();
	storage.value = JSON.stringify({ mode: "artist", artist: { id: "singer" }, queue: [] });
	assert.deepEqual(readLibrary(storage).queueSource, { type: "artist", resource: { id: "singer" }, page: 1 });
	storage.value = JSON.stringify({ mode: "liked", queue: [] });
	assert.deepEqual(readLibrary(storage).queueSource, { type: "liked" });
	storage.value = JSON.stringify({ queueSource: { type: "artist", resource: { id: "singer" }, page: -3 } });
	assert.equal(readLibrary(storage).queueSource.page, 1);
	assert.equal(readLibrary(storage).hasQueue, false);
});

test("artist history retains the ten most recently visited distinct artists across restarts", () => {
	let history = [];
	for (let i = 0; i < 12; i++) history = rememberArtist(history, { id: `artist${i}`, name: `歌手${i}`, avatarUrl: "https://y.gtimg.cn/a.jpg" });
	history = rememberArtist(history, { id: "artist5", name: "更新的名字", followerCount: 500 });
	const storage = memory();
	writeLibrary({ liked: [], queue: [], artistHistory: history }, storage);
	const restored = readLibrary(storage).artistHistory;
	assert.equal(restored.length, 10);
	assert.deepEqual(restored.map((artist) => artist.id), ["artist5", "artist11", "artist10", "artist9", "artist8", "artist7", "artist6", "artist4", "artist3", "artist2"]);
	assert.equal(restored[0].name, "更新的名字");
	assert.equal(restored[0].followerCount, 500);
	storage.value = JSON.stringify({ artistHistory: [null, {}, { id: "bad/id", name: "bad" }] });
	assert.deepEqual(readLibrary(storage).artistHistory, []);
});

test("long artist and album queues retain their current song, last page and completion on restart", () => {
	const storage = memory();
	const queue = Array.from({ length: 1205 }, (_, index) => ({ id: `song${index}`, title: `歌曲${index}` }));
	for (const type of ["artist", "album"]) {
		const queueSource = { type, resource: { id: "mid", name: "name" }, page: 25, hasMore: false };
		writeLibrary({ liked: [], queue, currentId: "song1204", queueSource }, storage);
		const restored = readLibrary(storage);
		assert.equal(restored.queue.length, 1205);
		assert.equal(restored.queue.at(-1).id, restored.currentId);
		assert.deepEqual(restored.queueSource, queueSource);
	}
});
