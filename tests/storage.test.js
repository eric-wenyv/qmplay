import test from "node:test";
import assert from "node:assert/strict";
import { readLibrary, writeLibrary } from "../src/storage.js";
const memory = () => ({
	value: null,
	getItem() {
		return this.value;
	},
	setItem(_key, value) {
		this.value = value;
	},
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
	assert.equal(readLibrary(storage).volume, 65);
	storage.value = JSON.stringify({
		liked: [null, {}, "travel"],
		queue: [],
		volume: 999,
	});
	assert.deepEqual(readLibrary(storage).liked, []);
	assert.equal(readLibrary(storage).volume, 100);
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

test("legacy server and quality settings are ignored and removed on save without losing the library", () => {
	const storage = memory();
	const song = { id: "favorite", title: "喜欢的歌" };
	storage.value = JSON.stringify({
		liked: [song],
		queue: [song],
		baseUrl: "https://old-server.example",
		quality: "128",
		volume: 42,
	});
	const restored = readLibrary(storage);
	assert.equal("baseUrl" in restored, false);
	assert.equal("quality" in restored, false);
	assert.equal(restored.liked[0].id, "favorite");
	assert.equal(restored.volume, 42);
	writeLibrary(
		{ ...restored, baseUrl: "https://old-server.example", quality: "128" },
		storage,
	);
	const saved = JSON.parse(storage.value);
	assert.equal("baseUrl" in saved, false);
	assert.equal("quality" in saved, false);
	assert.equal(saved.queue[0].id, "favorite");
});
