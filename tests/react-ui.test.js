import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// Install an actual DOM before ReactDOM initializes its browser event support.
const dom = new JSDOM(
  '<!doctype html><html><head><meta name="theme-color" content="#665e50"></head><body></body></html>',
  { url: "http://127.0.0.1:4173", pretendToBeVisual: true },
);
for (const name of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLImageElement",
  "Element",
  "Node",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "CustomEvent",
  "PageTransitionEvent",
]) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value: dom.window[name],
  });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { createApplication } = await import("../src/application/application.js");
const { App } = await import("../src/ui/App.js");

const songs = ["a", "b", "c"].map((id) => ({
  id,
  title: `歌曲 ${id}`,
  artist: "歌手",
  duration: 200,
}));
const artist = { id: "singer", name: "周杰伦", avatarUrl: "", followerCount: null };
const album = { id: "album", name: "专辑", coverUrl: "", publishDate: "2026-10-27" };
function memory() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    values,
  };
}
class Audio extends dom.window.EventTarget {
  paused = true;
  ended = false;
  readyState = 1;
  currentTime = 0;
  duration = 200;
  preload = "";
  src = "";
  loads = 0;
  load() {
    this.loads++;
    this.currentTime = 0;
  }
  removeAttribute() {
    this.src = "";
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
  async play() {
    this.paused = false;
    this.dispatchEvent(new Event("playing"));
  }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function click(selector, container = document) {
  const node = container.querySelector(selector);
  assert(node, `Missing rendered element: ${selector}`);
  await act(async () => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await tick();
  });
  return node;
}
async function keyboard(target, key, options = {}) {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true, ...options }),
    );
    await tick();
  });
}
async function input(selector, value) {
  const node = document.querySelector(selector);
  assert(node);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function trackListeners(target) {
  const add = target.addEventListener,
    remove = target.removeEventListener,
    listeners = new Map();
  target.addEventListener = function (type, listener, options) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(listener);
    return add.call(this, type, listener, options);
  };
  target.removeEventListener = function (type, listener, options) {
    listeners.get(type)?.delete(listener);
    return remove.call(this, type, listener, options);
  };
  return {
    listeners,
    restore() {
      target.addEventListener = add;
      target.removeEventListener = remove;
    },
  };
}
async function mount(t, { mobile = false, provider: overrides = {}, queue = songs } = {}) {
  document.body.innerHTML = "";
  delete window.qmplayDesktop;
  delete window.qmplayAndroid;
  if (!mobile) window.qmplayDesktop = { minimize() {}, close() {} };
  const media = Object.assign(new dom.window.EventTarget(), { matches: mobile });
  window.matchMedia = () => media;
  globalThis.matchMedia = window.matchMedia;
  const handlers = new Map();
  Object.defineProperty(navigator, "mediaSession", {
    configurable: true,
    value: {
      setActionHandler(name, handler) {
        if (handler) handlers.set(name, handler);
        else handlers.delete(name);
      },
      setPositionState() {},
    },
  });
  const intervals = new Set(),
    originalSetInterval = window.setInterval,
    originalClearInterval = window.clearInterval;
  let nextTimer = 1;
  window.setInterval = () => {
    const timer = nextTimer++;
    intervals.add(timer);
    return timer;
  };
  window.clearInterval = (timer) => intervals.delete(timer);
  const windowTracking = trackListeners(window),
    documentTracking = trackListeners(document);
  const requests = [],
    writes = [],
    storage = memory(),
    audio = new Audio();
  const audioTracking = trackListeners(audio);
  let remote = [];
  const provider = {
    async getAuthStatus() {
      requests.push("auth");
      return { authenticated: true, user: { uin: "100" } };
    },
    async getFavorites() {
      requests.push("favorites");
      return remote;
    },
    async setFavorite(track, liked) {
      writes.push([track.id, liked]);
      remote = remote.filter((song) => song.id !== track.id);
      if (liked) remote.push(track);
      return track;
    },
    async createLoginQr() {
      requests.push("qr");
      return { id: "qr", image: "data:image/png;base64,AA==", expiresAt: Date.now() + 120000 };
    },
    async checkLoginQr() {
      return { state: "waiting" };
    },
    async getPlayback(track) {
      requests.push(`play:${track.id}`);
      return `https://music.test/${track.id}`;
    },
    async searchArtists(query) {
      requests.push(`search:${query}`);
      return [artist];
    },
    async getFollowerCount() {
      return 123;
    },
    async getArtistAlbums() {
      return { albums: [album], hasMore: false };
    },
    async getArtistTrackPage() {
      return { tracks: songs, hasMore: false };
    },
    async getAlbumTrackPage() {
      return { tracks: [{ ...songs[0], id: "album-song", title: "专辑歌曲" }], hasMore: false };
    },
    async getRadioStations() {
      return [{ id: "777", name: "测试电台", group: "公共电台", coverUrl: "" }];
    },
    async getRadioTracks(id) {
      return [{ ...songs[0], id: `radio-${id}`, title: `电台 ${id}` }];
    },
    async getRecommendedTracks() {
      return songs;
    },
    async getLyrics() {
      return [
        { time: 0, text: "第一句" },
        { time: 42, text: "第二句" },
      ];
    },
    ...overrides,
  };
  const app = createApplication({
    provider,
    audio,
    storage,
    mobile,
    preferences: {
      queue,
      liked: [],
      accountUin: "100",
      currentId: queue[0]?.id,
      elapsed: 12,
      queueSource: { type: "radio", resource: { id: "199", name: "电台" } },
      artistHistory: [],
      hasQueue: true,
      order: "repeat",
      mode: "radio",
      station: { id: "199" },
      artist: null,
    },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let unmounted = false;
  const unmount = async () => {
    if (unmounted) return;
    await act(async () => {
      root.unmount();
      await tick();
    });
    unmounted = true;
  };
  t.after(async () => {
    await unmount();
    windowTracking.restore();
    documentTracking.restore();
    audioTracking.restore();
    window.setInterval = originalSetInterval;
    window.clearInterval = originalClearInterval;
    container.remove();
  });
  await act(async () => {
    root.render(createElement(App, { app }));
    await tick();
  });
  return {
    app,
    provider,
    audio,
    requests,
    writes,
    storage,
    container,
    media,
    handlers,
    intervals,
    windowTracking,
    documentTracking,
    audioTracking,
    unmount,
  };
}
async function chooseMode(mode) {
  await click("#mode-toggle");
  await click(`.mode-option[data-mode="${mode}"]`);
}

test("React restores an authenticated paused session and navigation preserves active playback", async (t) => {
  const player = await mount(t);
  assert.equal(player.app.getSnapshot().auth.state, "ready");
  assert.equal(document.querySelector("#auth-view").hidden, true);
  assert.equal(document.body.classList.contains("auth-gated"), false);
  assert.equal(document.querySelector("#track-title").textContent, "歌曲 a");
  assert.equal(document.querySelector("#elapsed").textContent, "0:12");
  assert.equal(player.requests.includes("qr"), false);
  assert.equal(player.audio.paused, true);
  await click("#play-toggle");
  assert.equal(player.audio.paused, false);
  assert.equal(document.querySelector("#play-toggle").getAttribute("aria-label"), "暂停");
  const loads = player.audio.loads;
  await chooseMode("radio");
  assert.equal(document.querySelector("#browse-view").hidden, false);
  assert.equal(player.audio.loads, loads);
  assert.equal(player.app.getSnapshot().playback.current.id, "a");
  await click('[data-station="777"]');
  assert.equal(document.querySelector("#track-title").textContent, "电台 777");
  assert.equal(player.audio.paused, false);
  assert(player.requests.includes("play:radio-777"));
});

test("React keeps network authentication failures retryable without starting a QR login", async (t) => {
  let offline = true;
  const player = await mount(t, {
    provider: {
      async getAuthStatus() {
        if (offline) throw new Error("网络暂时不可用");
        return { authenticated: true, user: { uin: "100" } };
      },
    },
  });
  assert.equal(player.app.getSnapshot().auth.state, "unavailable");
  assert.equal(document.querySelector("#auth-view").hidden, false);
  assert.equal(document.querySelector("#auth-message").textContent, "网络暂时不可用");
  assert.equal(document.querySelector("#auth-retry").textContent, "重新连接");
  assert.equal(player.requests.includes("qr"), false);
  offline = false;
  await click("#auth-retry");
  assert.equal(document.querySelector("#auth-view").hidden, true);
  assert.equal(document.querySelector("#track-title").textContent, "歌曲 a");
});

test("React favorite, lyric seek, and queue actions call the real application controllers", async (t) => {
  const player = await mount(t);
  await click("#like-toggle");
  assert.deepEqual(player.writes, [["a", true]]);
  assert.equal(document.querySelector("#like-toggle").getAttribute("aria-pressed"), "true");
  await click("#album-art");
  assert.equal(document.querySelector("#lyrics-view").hidden, false);
  assert.match(document.querySelector("#lyrics-lines").textContent, /第一句.*第二句/);
  await click('.lyric-line[data-time="42"]');
  assert.equal(player.app.getSnapshot().playback.elapsed, 42);
  await keyboard(document.body, "Escape");
  await click("#queue-toggle");
  assert.equal(document.querySelector("#queue-panel").getAttribute("role"), "dialog");
  assert.equal(document.querySelector("#queue-panel").hidden, false);
  assert.equal(document.activeElement.id, "close-queue");
  await click('[data-remove="1"]');
  assert.deepEqual(
    player.app.getSnapshot().playback.queue.map((track) => track.id),
    ["a", "c"],
  );
  await click('[data-index="1"]');
  assert.equal(document.querySelector("#queue-panel").hidden, true);
  assert.equal(document.querySelector("#track-title").textContent, "歌曲 c");
  assert.equal(player.audio.paused, false);
});

test("React search and album selection use typed data and render upstream text safely", async (t) => {
  const unsafeName = "<img src=x onerror=alert(1)>";
  const player = await mount(t, {
    provider: {
      async searchArtists(query) {
        player.requests.push(`search:${query}`);
        return [{ ...artist, name: unsafeName }];
      },
    },
  });
  await chooseMode("artist");
  assert.equal(document.activeElement.id, "search-input");
  await input("#search-input", "周杰伦");
  await act(async () => {
    document
      .querySelector("#artist-search")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await tick();
  });
  assert(player.requests.includes("search:周杰伦"));
  const row = document.querySelector('[data-artist="singer"]');
  assert(row);
  assert.match(row.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(row.querySelectorAll("img").length, 1);
  await click('[data-artist="singer"]');
  assert.equal(document.querySelector("#albums-view").hidden, false);
  assert.equal(document.activeElement.id, "play-artist");
  await click('[data-album="album"]');
  assert.equal(document.querySelector("#track-title").textContent, "专辑歌曲");
  assert.equal(player.app.getSnapshot().playback.source.type, "album");
});

test("React mobile queue and native back navigation preserve the listening source", async (t) => {
  const player = await mount(t, { mobile: true });
  await click("#play-toggle");
  const loads = player.audio.loads;
  await chooseMode("liked");
  assert.equal(document.querySelector("#liked-view").hidden, false);
  assert.equal(player.app.getSnapshot().playback.current.id, "a");
  await act(async () => {
    window.dispatchEvent(new CustomEvent("qmplay-back"));
  });
  assert.equal(player.app.getSnapshot().navigation.view, "player");
  await click("#queue-toggle");
  assert.equal(player.app.getSnapshot().navigation.view, "queue");
  assert.equal(document.querySelector("#queue-panel").getAttribute("role"), "region");
  assert.equal(document.querySelector("#queue-panel").hasAttribute("aria-modal"), false);
  assert.equal(document.activeElement.id, "queue-panel");
  await act(async () => {
    window.dispatchEvent(new CustomEvent("qmplay-back"));
  });
  assert.equal(player.app.getSnapshot().navigation.view, "player");
  assert.equal(player.audio.loads, loads);
  assert.equal(player.audio.paused, false);
  assert.equal(document.activeElement.id, "queue-toggle");
});

test("React virtual queue supports keyboard navigation and unmount cleans platform subscriptions", async (t) => {
  const queue = Array.from({ length: 500 }, (_, index) => ({
    ...songs[0],
    id: `track-${index}`,
    title: `歌曲 ${index}`,
  }));
  const player = await mount(t, { queue });
  await click("#queue-toggle");
  assert(document.querySelectorAll(".queue-item").length <= 60);
  const first = document.querySelector('[data-index="0"]');
  first.focus();
  await keyboard(first, "End");
  assert.equal(document.activeElement.dataset.index, "499");
  await keyboard(document.activeElement, "Home");
  const remove = document.querySelector('[data-remove="0"]');
  remove.focus();
  await keyboard(remove, "Tab");
  assert.equal(document.activeElement.dataset.index, "1");
  await keyboard(document.activeElement, "Tab", { shiftKey: true });
  assert.equal(document.activeElement.dataset.remove, "0");
  assert(document.querySelectorAll(".queue-item").length <= 60);
  assert(player.handlers.size > 0);
  assert.equal(player.intervals.size, 1);
  await player.unmount();
  assert.equal(player.intervals.size, 0);
  assert.equal(player.handlers.size, 0);
  for (const name of ["focus", "online", "pagehide", "pageshow", "qmplay-media", "qmplay-back"])
    assert.equal(
      player.windowTracking.listeners.get(name)?.size || 0,
      0,
      `Leaked window listener: ${name}`,
    );
  for (const name of ["keydown", "pointerdown", "focusin"])
    assert.equal(
      player.documentTracking.listeners.get(name)?.size || 0,
      0,
      `Leaked document listener: ${name}`,
    );
  assert.equal(document.body.classList.contains("desktop"), false);
  for (const [name, listeners] of player.audioTracking.listeners)
    assert.equal(listeners.size, 0, `Leaked audio listener: ${name}`);
  const elapsed = player.app.getSnapshot().playback.elapsed;
  player.audio.currentTime = 99;
  player.audio.dispatchEvent(new Event("timeupdate"));
  assert.equal(player.app.getSnapshot().playback.elapsed, elapsed);
});

test("React mobile menu traps keyboard focus and marks the underlying controls inert", async (t) => {
  const player = await mount(t, { mobile: true });
  await click("#mode-toggle");
  assert.equal(document.querySelector('.mode-option[data-mode="home"]').hidden, true);
  assert.equal(document.querySelector(".main-stage").hasAttribute("inert"), true);
  assert.equal(document.querySelector(".player-footer").hasAttribute("inert"), true);
  assert.equal(document.querySelector("#mode-toggle").hasAttribute("inert"), true);
  await keyboard(document.activeElement, "End");
  assert.equal(document.activeElement.dataset.mode, "artist");
  await keyboard(document.activeElement, "Tab");
  assert.equal(document.activeElement.dataset.mode, "radio");
  await keyboard(document.activeElement, "Tab", { shiftKey: true });
  assert.equal(document.activeElement.dataset.mode, "artist");
  await keyboard(document.activeElement, "Escape");
  assert.equal(player.app.getSnapshot().navigation.menuOpen, false);
  assert.equal(document.activeElement.id, "mode-toggle");
  assert.equal(document.querySelector(".main-stage").hasAttribute("inert"), false);
});

test("React search defers IME queries and removes stale clickable results as input changes", async (t) => {
  const player = await mount(t);
  await chooseMode("artist");
  const search = document.querySelector("#search-input");
  await act(async () => {
    search.dispatchEvent(new dom.window.CompositionEvent("compositionstart", { bubbles: true }));
  });
  await input("#search-input", "周");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 310));
  });
  assert.equal(player.requests.filter((request) => request.startsWith("search:")).length, 0);
  await input("#search-input", "周杰伦");
  await act(async () => {
    search.dispatchEvent(
      new dom.window.CompositionEvent("compositionend", { bubbles: true, data: "周杰伦" }),
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 310));
  });
  assert.deepEqual(
    player.requests.filter((request) => request.startsWith("search:")),
    ["search:周杰伦"],
  );
  assert(document.querySelector('[data-artist="singer"]'));
  await input("#search-input", "其他歌手");
  assert.equal(document.querySelector('[data-artist="singer"]'), null);
  assert.equal(document.querySelector("#artist-results").getAttribute("aria-busy"), "true");
  await player.unmount(); // Also cancels the pending debounce, before it can request data.
  await new Promise((resolve) => setTimeout(resolve, 310));
  assert.deepEqual(
    player.requests.filter((request) => request.startsWith("search:")),
    ["search:周杰伦"],
  );
});

async function pointer(target, type, x, y = 0) {
  await act(async () => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
    for (const [name, value] of Object.entries({
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
    }))
      Object.defineProperty(event, name, { value });
    target.dispatchEvent(event);
  });
}

test("React touch swipes suspend and resume the mounted page without changing playback", async (t) => {
  const player = await mount(t, { mobile: true });
  await chooseMode("artist");
  await input("#search-input", "周杰伦");
  await act(async () => {
    document
      .querySelector("#artist-search")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await tick();
  });
  const results = document.querySelector("#artist-results");
  results.scrollTop = 234;
  const stage = document.querySelector(".main-stage");
  await pointer(stage, "pointerdown", 0);
  await pointer(stage, "pointerup", 71);
  assert.equal(player.app.getSnapshot().navigation.view, "search");
  await pointer(stage, "pointerdown", 0);
  await pointer(stage, "pointermove", 20, 40);
  await pointer(stage, "pointerup", 100, 41);
  assert.equal(player.app.getSnapshot().navigation.view, "search");
  await pointer(stage, "pointerdown", 0);
  await pointer(stage, "pointerup", 100);
  assert.equal(player.app.getSnapshot().navigation.view, "player");
  assert.equal(document.querySelector("#search-view").hidden, true);
  await pointer(stage, "pointerdown", 100);
  await pointer(stage, "pointerup", 0);
  assert.equal(player.app.getSnapshot().navigation.view, "search");
  assert.equal(document.querySelector("#artist-results"), results);
  assert.equal(results.scrollTop, 234);
  assert.equal(document.querySelector("#search-input").value, "周杰伦");
  await click('[data-artist="singer"]'); // Suppress the synthetic click after a swipe.
  assert.equal(player.app.getSnapshot().navigation.view, "search");
  assert.equal(player.app.getSnapshot().playback.current.id, "a");
  assert.equal(player.requests.filter((request) => request.startsWith("play:")).length, 0);
});

test("React search consumes submitted debounces and reissues a cancelled query after input returns to it", async (t) => {
  const calls = [];
  const player = await mount(t, {
    provider: {
      searchArtists(query, { signal } = {}) {
        return new Promise((resolve) => calls.push({ query, signal, resolve }));
      },
    },
  });
  await chooseMode("artist");
  await input("#search-input", "A");
  await act(async () => {
    document
      .querySelector("#artist-search")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  assert.equal(calls.length, 1);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 310));
  });
  assert.equal(calls.length, 1, "Submitting the form must consume its pending debounce");
  await input("#search-input", "Aa");
  await input("#search-input", "A");
  assert.equal(calls[0].signal.aborted, true);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 310));
  });
  assert.deepEqual(
    calls.map((call) => call.query),
    ["A", "A"],
  );
  await act(async () => {
    calls[0].resolve([{ ...artist, id: "old", name: "旧结果" }]);
    await tick();
  });
  assert.equal(document.querySelector('[data-artist="old"]'), null);
  await act(async () => {
    calls[1].resolve([{ ...artist, id: "fresh", name: "新结果" }]);
    await tick();
  });
  assert(document.querySelector('[data-artist="fresh"]'));
  assert.equal(player.app.getSnapshot().requests.search, false);
});

test("React playback progress updates the timeline without traversing unchanged mounted feature lists", async (t) => {
  const player = await mount(t);
  await click("#like-toggle");
  await chooseMode("artist");
  await input("#search-input", "周杰伦");
  await act(async () => {
    document
      .querySelector("#artist-search")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await tick();
  });
  await click('[data-artist="singer"]');
  await chooseMode("radio");
  await click("#queue-toggle");
  const before = player.app.getSnapshot();
  const collections = new Map([
    [before.catalog.artists, "artists"],
    [before.catalog.albums, "albums"],
    [before.catalog.stations, "stations"],
    [before.library.liked, "favorites"],
    [before.playback.queue, "queue"],
  ]);
  const traversals = [],
    map = Array.prototype.map,
    slice = Array.prototype.slice;
  // Measure traversal of the public immutable collections, excluding React internals
  // and the controller's private mutable records.
  Array.prototype.map = function (...args) {
    if (collections.has(this)) traversals.push(collections.get(this));
    return map.apply(this, args);
  };
  Array.prototype.slice = function (...args) {
    if (collections.has(this)) traversals.push(collections.get(this));
    return slice.apply(this, args);
  };
  try {
    await act(async () => {
      player.audio.currentTime = 47;
      player.audio.dispatchEvent(new Event("timeupdate"));
      await tick();
    });
  } finally {
    Array.prototype.map = map;
    Array.prototype.slice = slice;
  }
  assert.equal(document.querySelector("#elapsed").textContent, "0:47");
  const after = player.app.getSnapshot();
  assert.equal(after.catalog, before.catalog);
  assert.equal(after.library, before.library);
  assert.equal(after.playback.queue, before.playback.queue);
  assert.deepEqual(
    traversals,
    [],
    "An audio clock update must not rerender unchanged catalog/favorite/queue lists",
  );
});
