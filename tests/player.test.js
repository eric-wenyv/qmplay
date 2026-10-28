import test from "node:test";
import assert from "node:assert/strict";
import { PlayerSession, formatTime } from "../src/player.js";

const songs = [
  { id: "a", duration: 10 },
  { id: "b", duration: 20 },
  { id: "c", duration: 30 },
];

for (const order of ["repeat", "shuffle", "repeatOne"]) {
  test(`inserted songs keep current progress and play next in ${order}`, () => {
    const player = new PlayerSession(() => 0.99);
    player.setQueue(songs);
    player.select(1);
    player.order = order;
    player.elapsed = 8;
    player.insertNext({ id: "x" });
    player.insertNext({ id: "y" });
    assert.deepEqual(
      player.queue.map((song) => song.id),
      ["a", "b", "y", "x", "c"],
    );
    assert.equal(player.current.id, "b");
    assert.equal(player.elapsed, 8);
    player.next({ automatic: true });
    assert.equal(player.current.id, "y");
    player.next({ automatic: true });
    assert.equal(player.current.id, "x");
    player.previous();
    assert.equal(player.current.id, "y");
    player.previous();
    assert.equal(player.current.id, "b");
  });
}
test("insertion and removal rebase listening history and queued next indexes", () => {
  const player = new PlayerSession();
  player.setQueue(songs);
  player.select(2);
  player.select(0);
  player.insertNext({ id: "x" });
  player.previous();
  assert.equal(player.current.id, "c");
  player.remove(0);
  assert.equal(player.current.id, "c");
  player.next();
  assert.equal(player.current.id, "x");
  player.insertNext({ id: "deleted" });
  player.remove(1);
  assert.equal(player.hasQueuedNext, false);
  player.setQueue([]);
  assert.equal(player.insertNext({ id: "first" }), 0);
  assert.equal(player.current.id, "first");
  assert.equal(player.playing, false);
});

test("removing the current song consumes its queued successor and restores validate saved indexes", () => {
  const player = new PlayerSession();
  player.setQueue(songs);
  player.insertNext({ id: "next" });
  player.remove(0);
  assert.equal(player.current.id, "next");
  assert.equal(player.hasQueuedNext, false);
  player.setQueue(songs, { trackId: "c", trackIndex: 0 });
  assert.equal(player.index, 2);
  player.setQueue(songs, { trackId: "b", trackIndex: 999 });
  assert.equal(player.index, 1);
});

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
