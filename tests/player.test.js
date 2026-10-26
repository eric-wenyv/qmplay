import test from "node:test";
import assert from "node:assert/strict";
import { PlayerSession, formatTime } from "../src/player.js";

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

test("seek clamps and previous restarts a song after three seconds", () => {
  const player = new PlayerSession();
  player.setQueue(songs, { autoplay: false });

  assert.equal(player.elapsed, 0);
  player.seek(100);
  assert.equal(player.elapsed, 10);
  player.previous();
  assert.equal(player.current.id, "a");
  assert.equal(player.elapsed, 0);
  player.seek(-12);
  assert.equal(player.elapsed, 0);
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

test("single-repeat replays on completion and manual next still advances", () => {
  const player = new PlayerSession();
  player.setQueue(songs);
  player.order = "repeatOne";
  player.elapsed = 10;
  player.next({ automatic: true });
  assert.equal(player.current.id, "a");
  assert.equal(player.elapsed, 0);
  player.next();
  assert.equal(player.current.id, "b");
});
