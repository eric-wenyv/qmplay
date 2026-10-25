import test from "node:test";
import assert from "node:assert/strict";
import { PlayerSession, formatTime } from "../src/player.js";
import { demoProvider, searchArtists } from "../src/data.js";

const songs = [
	{ id: "a", duration: 10 },
	{ id: "b", duration: 20 },
	{ id: "c", duration: 30 },
];

test("switching sources resets progress and an empty liked list cannot play", () => {
	const player = new PlayerSession();
	player.setQueue(songs);
	player.seek(7);
	player.setQueue([songs[2]]);
	assert.equal(player.current.id, "c");
	assert.equal(player.elapsed, 0);
	assert.equal(player.playing, true);
	player.setQueue([]);
	player.next();
	player.previous();
	player.seek(50);
	assert.equal(player.current, null);
	assert.equal(player.playing, false);
	assert.equal(player.elapsed, 0);
});

test("shuffle avoids immediate repeats and previous follows actual listening history", () => {
	const player = new PlayerSession(() => 0.99);
	player.setQueue(songs);
	player.order = "shuffle";
	player.next();
	assert.equal(player.current.id, "c");
	player.next();
	assert.equal(player.current.id, "b");
	player.previous();
	assert.equal(player.current.id, "c");
	player.previous();
	assert.equal(player.current.id, "a");
});

test("single-repeat repeats on completion while the next button advances", () => {
	const player = new PlayerSession();
	player.setQueue(songs);
	player.order = "repeatOne";
	assert.equal(player.tick(11), true);
	assert.equal(player.current.id, "a");
	assert.equal(player.elapsed, 0);
	player.next();
	assert.equal(player.current.id, "b");
});

test("pause stops time; seek clamps; previous restarts a song after three seconds", () => {
	const player = new PlayerSession();
	player.setQueue(songs, { autoplay: false });
	player.tick(5);
	assert.equal(player.elapsed, 0);
	player.seek(100);
	assert.equal(player.elapsed, 10);
	player.previous();
	assert.equal(player.current.id, "a");
	assert.equal(player.elapsed, 0);
	player.seek(-12);
	assert.equal(player.elapsed, 0);
});

test("an artist result yields only that artist’s songs; likes retain their selected ids", async () => {
	const result = searchArtists("  JAY  ");
	assert.equal(result[0].name, "周杰伦");
	assert.equal(searchArtists("杰伦")[0].id, "jay");
	assert.equal(searchArtists("not-an-artist").length, 0);
	const queue = await demoProvider.getArtistTracks(result[0].id);
	assert.equal(queue.length, 2);
	assert.ok(queue.every((track) => track.artistId === "jay"));
	const liked = await demoProvider.getLikedTracks(["red-bean", "sunny"]);
	assert.deepEqual(
		liked.map((track) => track.id),
		["red-bean", "sunny"],
	);
});

test("queue selection rejects invalid indexes and formats elapsed time safely", () => {
	const player = new PlayerSession();
	player.setQueue(songs);
	assert.equal(player.select(-1), false);
	assert.equal(player.select(3), false);
	assert.equal(player.select(1.5), false);
	assert.equal(player.select(2), true);
	assert.equal(player.current.id, "c");
	assert.equal(formatTime(192.9), "3:12");
	assert.equal(formatTime(-5), "0:00");
	assert.equal(formatTime(NaN), "0:00");
});
