import test from "node:test";
import assert from "node:assert/strict";
import { AudioTransport } from "../src/audio.js";
class FakeAudio extends EventTarget {
  paused = true;
  ended = false;
  readyState = 1;
  currentTime = 0;
  duration = 200;
  load() {}
  removeAttribute() {}
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
  async play() {
    this.paused = false;
    this.dispatchEvent(new Event("playing"));
  }
}
const a = { id: "a", duration: 200 },
  b = { id: "b", duration: 200 };
test("a late playback URL cannot replace a newer selected song", async () => {
  let resolveA;
  const audio = new FakeAudio();
  const transport = new AudioTransport({
    audio,
    provider: {
      getPlayback: (t) =>
        t.id === "a"
          ? new Promise((resolve) => {
              resolveA = resolve;
            })
          : Promise.resolve("https://music.test/b"),
    },
  });
  const first = transport.select(a, { autoplay: true });
  await transport.select(b, { autoplay: true });
  resolveA("https://music.test/a");
  await first;
  assert.equal(audio.src, "https://music.test/b");
  assert.equal(audio.paused, false);
});
test("pause cancels an in-flight play request and cannot start audio after resolution", async () => {
  let resolve;
  const audio = new FakeAudio();
  const transport = new AudioTransport({
    audio,
    provider: {
      getPlayback: () =>
        new Promise((r) => {
          resolve = r;
        }),
    },
  });
  const playing = transport.select(a, { autoplay: true });
  transport.pause();
  resolve("https://music.test/a");
  await playing;
  assert.equal(audio.paused, true);
  assert.equal(transport.desiredPlaying, false);
});
test("media events drive progress, duration, seek and completion", async () => {
  const audio = new FakeAudio();
  let progress,
    ended = false;
  const transport = new AudioTransport({
    audio,
    provider: { getPlayback: async () => "https://music.test/a" },
    onProgress: (...p) => {
      progress = p;
    },
    onEnded: () => {
      ended = true;
    },
  });
  await transport.select(a, { autoplay: true, elapsed: 12 });
  audio.dispatchEvent(new Event("loadedmetadata"));
  assert.equal(audio.currentTime, 12);
  audio.currentTime = 35;
  audio.dispatchEvent(new Event("timeupdate"));
  assert.deepEqual(progress, [35, 200]);
  transport.seek(800);
  assert.equal(audio.currentTime, 200);
  audio.dispatchEvent(new Event("ended"));
  assert.equal(ended, true);
});
test("failed playback resets actual state and reports an actionable error", async () => {
  const audio = new FakeAudio();
  let error;
  const transport = new AudioTransport({
    audio,
    provider: {
      getPlayback: async () => {
        throw Error("没有权限");
      },
    },
    onError: (e) => {
      error = e;
    },
  });
  await transport.select(a, { autoplay: true });
  assert.equal(audio.paused, true);
  assert.equal(transport.loading, false);
  assert.equal(error.message, "没有权限");
});
test("media load errors make retry fetch a fresh URL", async () => {
  const audio = new FakeAudio();
  let calls = 0;
  const transport = new AudioTransport({
    audio,
    provider: { getPlayback: async () => `https://music.test/${++calls}` },
  });
  await transport.select(a, { autoplay: true });
  audio.error = { code: 2 };
  audio.pause();
  audio.dispatchEvent(new Event("error"));
  await transport.play();
  assert.equal(calls, 2);
});
