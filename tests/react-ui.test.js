import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { icon } from "../src/icons.js";

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
const { openQqLogin } = await import("../src/platform/qqLogin.js");
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
function assertMobileHomeTarget(label, iconName) {
  const button = document.querySelector("#home-toggle");
  assert.equal(button.getAttribute("aria-label"), label);
  const expected = document.createElement("span");
  expected.innerHTML = icon(iconName);
  assert(button.querySelector("svg").isEqualNode(expected.firstElementChild));
}

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
async function mount(t, { mobile = false, provider: overrides = {}, queue = songs, openQq } = {}) {
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
    async getDailyRecommendedTracks() {
      requests.push("daily");
      return [{ ...songs[0], id: "daily-track", title: "每日推荐歌曲" }];
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
    openQqLogin: openQq,
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

for (const mobile of [false, true]) {
  test(`radio song rows play while their next buttons queue without interruption (${mobile ? "mobile" : "desktop"})`, async (t) => {
    const found = { id: "found", title: "晴天 <img src=x>", artist: "周杰伦" };
    const player = await mount(t, {
      mobile,
      provider: {
        async searchTracks(query, page) {
          player.requests.push(`songs:${query}:${page}`);
          return { tracks: [found], hasMore: false };
        },
      },
    });
    await act(async () => {
      await player.app.play();
    });
    await chooseMode("radio");
    assert.equal(document.querySelector("#browse-view").firstElementChild.id, "track-search");
    assert.equal(document.querySelector("#browse-view h2"), null);
    assert.notEqual(document.activeElement.id, "track-search-input");
    await input("#track-search-input", "晴天");
    await act(async () => {
      document
        .querySelector("#track-search")
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await tick();
    });
    assert.equal(document.querySelector("#radio-results"), null);
    assert.equal(document.querySelector("#track-results .artist-name").textContent, found.title);
    assert.equal(document.querySelector("#track-results .artist-name img"), null);
    const row = document.querySelector('[data-search-track="found"]');
    const next = document.querySelector('[data-next-track="found"]');
    assert(next);
    assert.equal(next.title, "添加到下一首播放");
    assert.equal(row.parentElement === next.parentElement, true);
    assert.equal(document.querySelector("#track-results button button"), null);
    assert.equal(row.querySelector(".icon-slot"), null);
    const loads = player.audio.loads;
    const elapsed = player.app.getSnapshot().playback.elapsed;
    await act(async () => {
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      row.dispatchEvent(event);
      assert.equal(event.defaultPrevented, false);
    });
    assert.equal(document.querySelector(".track-context-menu"), null);
    await click('[data-next-track="found"]');
    assert.equal(player.audio.loads, loads);
    assert.equal(player.audio.paused, false);
    assert.equal(player.app.getSnapshot().playback.elapsed, elapsed);
    assert.deepEqual(
      player.app.getSnapshot().playback.queue.map((track) => track.id),
      ["a", "found", "b", "c"],
    );
    await click('[data-search-track="found"]');
    assert.equal(player.app.getSnapshot().playback.current.id, "found");
    assert.equal(player.audio.paused, false);
    assert.deepEqual(
      player.app.getSnapshot().playback.queue.map((track) => track.id),
      ["a", "found", "found", "b", "c"],
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 310));
    });
    assert.deepEqual(
      player.requests.filter((item) => item.startsWith("songs:")),
      ["songs:晴天:1"],
    );
    await input("#track-search-input", "");
    assert(document.querySelector('[data-station="99"]'));
  });
}

test("artist, album, favorite and radio lists use whole-row actions without trailing play icons", async (t) => {
  const player = await mount(t);
  const assertNoPlayIcon = (selector) => {
    assert(document.querySelector(`${selector} .artist-row`));
    assert.equal(document.querySelectorAll(`${selector} .artist-row > .icon-slot`).length, 0);
  };
  await chooseMode("radio");
  assertNoPlayIcon("#radio-results");
  await chooseMode("artist");
  await input("#search-input", "周杰伦");
  await act(async () => {
    document
      .querySelector("#artist-search")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await tick();
  });
  assertNoPlayIcon("#artist-results");
  await click('[data-artist="singer"]');
  assert.equal(player.app.getSnapshot().navigation.view, "albums");
  assertNoPlayIcon("#album-results");
  await click('[data-album="album"]');
  assert.equal(player.app.getSnapshot().navigation.view, "albumTracks");
  assert.equal(player.app.getSnapshot().playback.current.id, "a");
  assertNoPlayIcon("#album-track-results");
  await click("#play-album");
  assert.equal(player.app.getSnapshot().playback.current.id, "album-song");
  await click("#like-toggle");
  await chooseMode("liked");
  assertNoPlayIcon("#liked-results");
  await click('[data-liked-track="album-song"]');
  assert.equal(player.app.getSnapshot().playback.source.type, "album");
  assert.deepEqual(
    player.app.getSnapshot().playback.queue.map((track) => track.id),
    ["album-song", "album-song"],
  );
  await click("#play-liked");
  assert.equal(player.app.getSnapshot().playback.source.type, "liked");
  assert.deepEqual(
    player.app.getSnapshot().playback.queue.map((track) => track.id),
    ["album-song"],
  );
});

for (const mobile of [false, true]) {
  test(`favorite song rows insert into the current queue and only play-all replaces it (${mobile ? "mobile" : "desktop"})`, async (t) => {
    const favorites = [
      { id: "favorite", title: "喜欢的歌", artist: "歌手", duration: 200 },
      { id: "other-favorite", title: "另一首", artist: "歌手", duration: 200 },
    ];
    const player = await mount(t, {
      mobile,
      provider: {
        async getFavorites() {
          return favorites;
        },
      },
    });
    await act(async () => {
      await player.app.play();
      player.app.seek(32);
    });
    await chooseMode("liked");
    const source = player.app.getSnapshot().playback.source;
    const loads = player.audio.loads;
    assert.equal(document.querySelectorAll("#liked-results [data-next-track]").length, 2);
    assert.equal(document.querySelector("#liked-results button button"), null);
    await click('#liked-results [data-next-track="favorite"]');
    assert.equal(player.audio.loads, loads);
    assert.equal(player.audio.paused, false);
    assert.equal(player.app.getSnapshot().playback.current.id, "a");
    assert.equal(player.app.getSnapshot().playback.elapsed, 32);
    assert.deepEqual(player.app.getSnapshot().playback.source, source);
    assert.deepEqual(
      player.app.getSnapshot().playback.queue.map((track) => track.id),
      ["a", "favorite", "b", "c"],
    );
    await click('[data-liked-track="other-favorite"]');
    assert.equal(player.app.getSnapshot().playback.current.id, "other-favorite");
    assert.equal(player.audio.paused, false);
    assert.equal(player.app.getSnapshot().navigation.view, "liked");
    assert.deepEqual(player.app.getSnapshot().playback.source, source);
    assert.deepEqual(
      player.app.getSnapshot().playback.queue.map((track) => track.id),
      ["a", "other-favorite", "favorite", "b", "c"],
    );
    assert.deepEqual(player.app.getSnapshot().library.liked, favorites);
    await click("#play-liked");
    assert.equal(player.app.getSnapshot().playback.source.type, "liked");
    assert.deepEqual(
      player.app.getSnapshot().playback.queue.map((track) => track.id),
      ["favorite", "other-favorite"],
    );
    assert.equal(player.app.getSnapshot().playback.current.id, "favorite");
    assert.equal(player.audio.paused, false);
  });
}

test("favorite song actions create a queue when none exists", async (t) => {
  const favorite = { id: "first-favorite", title: "第一首", duration: 200 };
  const player = await mount(t, {
    queue: [],
    provider: {
      async getFavorites() {
        return [favorite];
      },
    },
  });
  await chooseMode("liked");
  await click('[data-next-track="first-favorite"]');
  assert.equal(player.app.getSnapshot().playback.current.id, "first-favorite");
  assert.equal(player.audio.paused, true);
  assert.equal(player.app.getSnapshot().playback.source, null);
  await click('[data-liked-track="first-favorite"]');
  assert.equal(player.audio.paused, false);
  assert.deepEqual(
    player.app.getSnapshot().playback.queue.map((track) => track.id),
    ["first-favorite", "first-favorite"],
  );
});

for (const mobile of [false, true]) {
  test(`album selection browses songs and only play-all replaces playback (${mobile ? "mobile" : "desktop"})`, async (t) => {
    const track = { id: "album-song", title: "专辑歌曲", artist: "歌手", duration: 200 };
    const calls = [];
    const player = await mount(t, {
      mobile,
      provider: {
        async getAlbumTrackPage(_id, page) {
          calls.push(page);
          return {
            tracks: page === 1 ? [track] : [{ ...track, id: "second" }],
            hasMore: page === 1,
          };
        },
      },
    });
    await act(async () => {
      await player.app.play();
      player.app.seek(32);
    });
    await chooseMode("artist");
    await act(async () => {
      await player.app.showArtistAlbums(artist);
    });
    const source = player.app.getSnapshot().playback.source;
    const loads = player.audio.loads;
    await click('[data-album="album"]');
    assert.equal(player.app.getSnapshot().navigation.view, "albumTracks");
    assert.equal(player.app.getSnapshot().navigation.mobileMode, mobile ? "artist" : "radio");
    if (mobile) {
      assertMobileHomeTarget("主页", "home");
      await click("#home-toggle");
      assertMobileHomeTarget("专辑歌曲", "artist");
      await click("#home-toggle");
      assert.equal(player.app.getSnapshot().navigation.view, "albumTracks");
    }
    assert.equal(player.audio.loads, loads);
    assert.equal(player.app.getSnapshot().playback.current.id, "a");
    assert.equal(player.app.getSnapshot().playback.elapsed, 32);
    await click('#album-track-results [data-next-track="album-song"]');
    assert.equal(player.audio.loads, loads);
    assert.equal(player.audio.paused, false);
    assert.deepEqual(
      player.app.getSnapshot().playback.queue.map((item) => item.id),
      ["a", "album-song", "b", "c"],
    );
    await click('[data-album-track="album-song"]');
    assert.equal(player.app.getSnapshot().playback.current.id, "album-song");
    assert.deepEqual(player.app.getSnapshot().playback.source, source);
    assert.deepEqual(
      player.app.getSnapshot().playback.queue.map((item) => item.id),
      ["a", "album-song", "album-song", "b", "c"],
    );
    await click("#album-track-results .load-more");
    assert.deepEqual(calls, [1, 2]);
    assert.equal(document.querySelectorAll("[data-album-track]").length, 2);
    await click("#album-tracks-back");
    assert.equal(player.app.getSnapshot().navigation.view, "albums");
    await click('[data-album="album"]');
    await click("#play-album");
    assert.equal(player.app.getSnapshot().playback.source.type, "album");
    assert.equal(player.app.getSnapshot().playback.current.id, "album-song");
    assert.equal(player.audio.paused, false);
    assert(!player.app.getSnapshot().playback.queue.some((item) => item.id === "a"));
  });
}

test("queue remove buttons preserve the current song and remain separate from the full-row play action", async (t) => {
  const player = await mount(t);
  await act(async () => {
    await player.app.play();
    player.app.seek(28);
  });
  await click("#queue-toggle");
  const row = document.querySelector('[data-index="1"]');
  const remove = document.querySelector('[data-remove="1"]');
  assert.equal(row.parentElement === remove.parentElement, true);
  assert.equal(document.querySelector("#queue-list button button"), null);
  const loads = player.audio.loads;
  await click('[data-remove="1"]');
  assert.equal(player.audio.loads, loads);
  assert.equal(player.audio.paused, false);
  assert.equal(player.app.getSnapshot().playback.current.id, "a");
  assert.equal(player.app.getSnapshot().playback.elapsed, 28);
  assert.equal(player.app.getSnapshot().navigation.queueOpen, true);
  assert.deepEqual(
    player.app.getSnapshot().playback.queue.map((item) => item.id),
    ["a", "c"],
  );
});

test("radio search defers IME input, clears stale rows and pages song results", async (t) => {
  const calls = [];
  const player = await mount(t, {
    provider: {
      async searchTracks(query, page) {
        calls.push([query, page]);
        return { tracks: [{ id: String(page), title: query }], hasMore: page === 1 };
      },
    },
  });
  await chooseMode("radio");
  const field = document.querySelector("#track-search-input");
  await act(async () => {
    field.dispatchEvent(new dom.window.CompositionEvent("compositionstart", { bubbles: true }));
  });
  await input("#track-search-input", "晴");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 310));
  });
  assert.equal(calls.length, 0);
  await input("#track-search-input", "晴天");
  await act(async () => {
    field.dispatchEvent(
      new dom.window.CompositionEvent("compositionend", { bubbles: true, data: "晴天" }),
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 310));
  });
  assert.deepEqual(calls, [["晴天", 1]]);
  await click("#track-results .load-more");
  assert.deepEqual(calls, [
    ["晴天", 1],
    ["晴天", 2],
  ]);
  assert.equal(document.querySelectorAll("[data-search-track]").length, 2);
  assert.equal(document.querySelector("#track-results .load-more"), null);
  await input("#track-search-input", "新歌");
  assert.equal(document.querySelector("[data-search-track]"), null);
  await chooseMode("liked");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 310));
  });
  assert.equal(calls.length, 2);
  assert.equal(player.app.getSnapshot().requests.trackSearch, false);
});

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
  assert.deepEqual(
    [...document.querySelectorAll("[data-station] .artist-name")].map((item) => item.textContent),
    ["私人电台", "每日30首"],
  );
  await click('[data-station="99"]');
  assert.equal(document.querySelector("#track-title").textContent, "电台 99");
  assert.equal(player.audio.paused, false);
  assert(player.requests.includes("play:radio-99"));
  await chooseMode("radio");
  await click('[data-station="daily"]');
  assert.equal(document.querySelector("#track-title").textContent, "每日推荐歌曲");
  assert(player.requests.includes("daily"));
  assert.equal(player.app.getSnapshot().playback.source.hasMore, false);
});

for (const mobile of [false, true]) {
  test(`React shows the saved player throughout background login checks (${mobile ? "mobile" : "desktop"})`, async (t) => {
    let resolveStatus, resolveFavorites;
    const status = new Promise((resolve) => (resolveStatus = resolve));
    const favorites = new Promise((resolve) => (resolveFavorites = resolve));
    const player = await mount(t, {
      mobile,
      provider: {
        getAuthStatus: () => status,
        getFavorites: () => favorites,
      },
    });
    const cover = document.querySelector("#cover-image");
    const assertPlayerVisible = () => {
      assert.equal(player.app.getSnapshot().auth.state, "checking");
      assert.equal(document.querySelector("#auth-view").hidden, true);
      assert.equal(document.body.classList.contains("auth-gated"), false);
      assert.equal(document.querySelector("#listening-view").hidden, false);
      assert.equal(document.querySelector("#track-title").textContent, "歌曲 a");
      assert.equal(document.querySelector("#elapsed").textContent, "0:12");
      assert.equal(document.querySelector(".main-stage").hasAttribute("inert"), true);
      assert.equal(document.querySelector(".player-footer").hasAttribute("inert"), true);
      assert.equal(player.audio.loads, 0);
      assert.equal(player.audio.paused, true);
      assert.equal(player.requests.includes("qr"), false);
    };
    assertPlayerVisible();
    await keyboard(document.body, " ", { code: "Space" });
    assert.equal(player.audio.paused, true);
    await act(async () => {
      resolveStatus({ authenticated: true, user: { uin: "100" } });
      await tick();
    });
    assertPlayerVisible(); // Slow cloud favorites must not reintroduce a login screen.
    await act(async () => {
      resolveFavorites([]);
      await tick();
    });
    assert.equal(player.app.getSnapshot().auth.state, "ready");
    assert.equal(document.querySelector("#cover-image"), cover);
    assert.equal(document.querySelector("#auth-view").hidden, true);
    assert.equal(document.querySelector(".main-stage").hasAttribute("inert"), false);
    assert.equal(document.querySelector(".player-footer").hasAttribute("inert"), false);
    assert.equal(player.audio.loads, 1);
    assert.equal(player.audio.paused, true);
  });
}

test("React replaces the initial player with QR login only after a missing session is confirmed", async (t) => {
  let resolveStatus;
  const player = await mount(t, {
    queue: [],
    provider: {
      getAuthStatus: () => new Promise((resolve) => (resolveStatus = resolve)),
    },
  });
  assert.equal(document.querySelector("#empty-view").hidden, false);
  assert.equal(document.querySelector("#auth-view").hidden, true);
  assert.equal(document.body.classList.contains("auth-gated"), false);
  assert.equal(player.requests.includes("qr"), false);
  await act(async () => {
    resolveStatus({ authenticated: false });
    await tick();
  });
  assert.equal(player.app.getSnapshot().auth.state, "waiting");
  assert.equal(document.querySelector("#auth-view").hidden, false);
  assert.equal(document.body.classList.contains("auth-gated"), true);
  assert.equal(document.querySelector("#auth-qr").hidden, false);
  assert.equal(player.audio.loads, 0);
  assert.equal(player.requests.includes("qr"), true);
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

test("desktop verification checks an active session and enters QR login only when it expires", async (t) => {
  const player = await mount(t);
  const button = document.querySelector("#verify-login");
  assert.equal(button.nextElementSibling.id, "minimize-window");
  await click("#play-toggle");
  await click("#verify-login");
  assert.equal(document.querySelector("#notice-message").textContent, "QQ 音乐登录有效");
  assert.equal(player.audio.paused, false);

  player.provider.getAuthStatus = async () => {
    throw new Error("网络暂时不可用");
  };
  await click("#verify-login");
  assert.match(
    document.querySelector("#notice-message").textContent,
    /无法完成登录验证.*网络暂时不可用/,
  );
  assert.equal(player.app.getSnapshot().auth.state, "ready");
  assert.equal(player.audio.paused, false);
  assert.equal(player.requests.includes("qr"), false);

  player.provider.getAuthStatus = async () => ({ authenticated: false });
  await click("#notice-action");
  assert.equal(player.app.getSnapshot().auth.state, "waiting");
  assert.equal(player.audio.paused, true);
  assert.equal(document.querySelector("#auth-qr").hidden, false);
});

test("mobile login shows a dedicated button and restores the player after QQ confirmation", async (t) => {
  const login = { url: "https://txz.qq.com/p", id: "mobile-login", expiresAt: Date.now() + 60000 };
  const opens = [];
  const checks = [];
  let canOpen = false;
  const player = await mount(t, {
    mobile: true,
    openQq: openQqLogin,
    provider: {
      createQqLogin: async () => login,
      checkLoginQr: async (id) => {
        checks.push(id);
        return { state: "authenticated", user: { uin: "100" } };
      },
    },
  });
  window.qmplayAndroid = {
    playback() {},
    openQqLogin: (url) => {
      opens.push(url);
      return canOpen;
    },
  };
  player.provider.getAuthStatus = async () => ({ authenticated: false });
  await click("#verify-login");
  assert.equal(player.app.getSnapshot().auth.state, "needsLogin");
  assert.equal(document.querySelector("#verify-login"), null);
  assert.deepEqual(opens, []);
  const loginButton = document.querySelector("#auth-retry");
  assert.equal(loginButton.textContent, "登录");
  assert.equal(loginButton.previousElementSibling.className, "auth-caption");
  assert.equal(loginButton.disabled, false);
  assert.equal(document.querySelector("#auth-qr").hidden, true);

  await click("#auth-retry");
  assert.equal(player.app.getSnapshot().auth.state, "loginError");
  assert.equal(loginButton.disabled, false);
  assert.deepEqual(checks, []);
  canOpen = true;
  await click("#auth-retry");
  assert.equal(player.app.getSnapshot().auth.state, "authorizing");
  assert.equal(loginButton.disabled, true);
  assert.equal(loginButton.getAttribute("aria-busy"), "true");
  assert.deepEqual(opens, [login.url, login.url]);
  await act(async () => {
    await new Promise((resolve) => {
      const unsubscribe = player.app.subscribe(() => {
        if (player.app.getSnapshot().auth.state === "ready") {
          unsubscribe();
          resolve();
        }
      });
    });
  });
  assert.equal(document.querySelector("#auth-view").hidden, true);
  assert.deepEqual(checks, [login.id]);
  assert.equal(player.requests.includes("qr"), false);
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
  assert.equal(document.querySelector("#album-tracks-view").hidden, false);
  assert.equal(player.app.getSnapshot().playback.current.id, "a");
  assert.equal(player.app.getSnapshot().playback.source.type, "radio");
  await click("#play-album");
  assert.equal(document.querySelector("#track-title").textContent, "专辑歌曲");
  assert.equal(player.app.getSnapshot().playback.source.type, "album");
});

test("React mobile home and native back navigation preserve the listening source", async (t) => {
  const player = await mount(t, { mobile: true });
  await click("#play-toggle");
  const loads = player.audio.loads;
  assert.equal(document.querySelector("#queue-toggle"), null);
  assert.equal(document.querySelector("#queue-panel").hidden, true);
  assertMobileHomeTarget("喜欢的音乐", "heart");
  await click("#home-toggle");
  assert.equal(document.querySelector("#liked-view").hidden, false);
  assertMobileHomeTarget("主页", "home");
  assert.equal(player.app.getSnapshot().playback.current.id, "a");
  await act(async () => {
    window.dispatchEvent(new CustomEvent("qmplay-back"));
  });
  assert.equal(player.app.getSnapshot().navigation.view, "player");
  assertMobileHomeTarget("喜欢的音乐", "heart");
  await click("#home-toggle");
  assert.equal(player.app.getSnapshot().navigation.view, "liked");
  await click("#home-toggle");
  assert.equal(player.app.getSnapshot().navigation.view, "player");
  await chooseMode("radio");
  assertMobileHomeTarget("主页", "home");
  await click("#home-toggle");
  assertMobileHomeTarget("推荐电台", "radio");
  await click("#home-toggle");
  assert.equal(player.app.getSnapshot().navigation.view, "browse");
  assert.equal(player.audio.loads, loads);
  assert.equal(player.audio.paused, false);
});

test("React opens the mobile queue from the drawer and remembers it as the home destination", async (t) => {
  const player = await mount(t, { mobile: true });
  const queue = document.querySelector("#queue-panel");
  const loads = player.audio.loads;
  await chooseMode("queue");
  assert.equal(player.app.getSnapshot().navigation.view, "queue");
  assert.equal(player.app.getSnapshot().navigation.menuOpen, false);
  assert.equal(queue.getAttribute("role"), "region");
  assert.equal(queue.hasAttribute("aria-modal"), false);
  assert.equal(queue.hidden, false);
  assert.equal(document.activeElement, queue);
  assertMobileHomeTarget("主页", "home");
  await click("#home-toggle");
  assert.equal(queue.hidden, true);
  assertMobileHomeTarget("播放队列", "queue");
  await click("#home-toggle");
  assert.equal(queue.hidden, false);
  assert.equal(player.audio.loads, loads);
  await click('#queue-list [data-index="1"]');
  assert.equal(queue.hidden, true);
  assert.equal(player.app.getSnapshot().navigation.view, "player");
  assert.equal(player.app.getSnapshot().playback.current.id, "b");
  assert.equal(player.audio.paused, false);
  assertMobileHomeTarget("播放队列", "queue");
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
  assert.equal(document.querySelector('.mode-option[data-mode="home"]'), null);
  assert.equal(document.querySelector(".main-stage").hasAttribute("inert"), true);
  assert.equal(document.querySelector(".player-footer").hasAttribute("inert"), true);
  assert.equal(document.querySelector("#mode-toggle").hasAttribute("inert"), false);
  assert.equal(document.querySelector("#mode-toggle").getAttribute("role"), "slider");
  await keyboard(document.activeElement, "End");
  assert.equal(document.activeElement.dataset.mode, "artist");
  await keyboard(document.activeElement, "Tab");
  assert.equal(document.activeElement.dataset.mode, "queue");
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

function dispatchPointer(target, type, x, y = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  for (const [name, value] of Object.entries({
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
  }))
    Object.defineProperty(event, name, { value });
  target.dispatchEvent(event);
}

async function pointer(target, type, x, y = 0) {
  await act(async () => dispatchPointer(target, type, x, y));
}

// jsdom does not lay out the mobile stops; give the real components their browser geometry.
function mobileNavigationBounds() {
  const control = document.querySelector(".mode-control");
  const thumb = document.querySelector("#mode-toggle");
  const rect = (x) => ({ left: x, top: 300, right: x + 44, bottom: 344, width: 44, height: 44 });
  control.getBoundingClientRect = () => rect(200);
  for (const [index, mode] of ["queue", "radio", "liked", "artist"].entries())
    document.querySelector(`[data-mode="${mode}"]`).getBoundingClientRect = () =>
      rect(56 + index * 48);
  thumb.getBoundingClientRect = () =>
    rect(200 + Number(thumb.style.transform.match(/translate\(([-\d.]+)px/)?.[1] || 0));
  return { control, thumb };
}

test("React mobile navigation accepts taps and a loose drag without changing playback", async (t) => {
  const player = await mount(t, { mobile: true });
  const { thumb } = mobileNavigationBounds();
  const source = player.app.getSnapshot().playback.source;
  const loads = player.audio.loads;
  await click("#mode-toggle");
  assert.equal(thumb.getAttribute("role"), "slider");
  assert.equal(thumb.getAttribute("aria-valuenow"), "1");
  await pointer(thumb, "pointerdown", 126, 322);
  await pointer(thumb, "pointermove", 180, 360);
  assert.equal(thumb.getAttribute("aria-valuetext"), "喜欢的音乐");
  assert.equal(thumb.getAttribute("aria-valuenow"), "2");
  assert.equal(player.app.getSnapshot().navigation.view, "player");
  await pointer(thumb, "pointerup", 188, 382); // 14px from the stop and 60px below the starting finger.
  assert.equal(player.app.getSnapshot().navigation.view, "liked");
  assert.equal(player.app.getSnapshot().navigation.menuOpen, false);
  await act(async () => {
    thumb.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  });
  assert.equal(
    player.app.getSnapshot().navigation.menuOpen,
    false,
    "A drag's trailing click must not reopen the menu",
  );
  await chooseMode("artist");
  assert.equal(player.app.getSnapshot().navigation.view, "search");
  assert.equal(player.audio.loads, loads);
  assert.deepEqual(player.app.getSnapshot().playback.source, source);
});

test("React mobile thumb can reveal the selector while dragging and tolerates endpoint overshoot", async (t) => {
  const player = await mount(t, { mobile: true });
  const { thumb } = mobileNavigationBounds();
  await pointer(thumb, "pointerdown", 222, 322);
  await pointer(thumb, "pointermove", 166, 355);
  assert.equal(player.app.getSnapshot().navigation.menuOpen, true);
  assert.equal(document.querySelector(".mode-control").dataset.dragging, "true");
  await pointer(thumb, "pointerup", 156, 398);
  assert.equal(player.app.getSnapshot().navigation.view, "liked");
  await pointer(thumb, "pointerdown", 222, 322);
  await pointer(thumb, "pointermove", 0, 340);
  await pointer(thumb, "pointerup", 0, 340);
  assert.equal(player.app.getSnapshot().navigation.view, "queue");
  assert.equal(player.app.getSnapshot().navigation.menuOpen, false);
  assert.equal(player.app.getSnapshot().playback.current.id, "a");
});

test("React mobile thumb cancels interrupted and distant drags without selecting a page", async (t) => {
  const player = await mount(t, { mobile: true });
  const { thumb, control } = mobileNavigationBounds();
  await click("#mode-toggle");
  for (const ending of ["pointercancel", "lostpointercapture", "pointerup"]) {
    await pointer(thumb, "pointerdown", 126, 322);
    await pointer(thumb, "pointermove", 180, 340);
    await pointer(thumb, ending, 180, 420);
    assert.equal(player.app.getSnapshot().navigation.view, "player");
    assert.equal(control.dataset.dragging, "false");
    assert.equal(thumb.getAttribute("aria-valuenow"), "1");
  }
  await pointer(thumb, "pointerdown", 126, 322);
  await act(async () => {
    // A very quick interruption can coalesce both React updates into one render.
    dispatchPointer(thumb, "pointermove", 180, 340);
    dispatchPointer(thumb, "pointercancel", 180, 340);
  });
  assert.equal(thumb.style.transform, "translate(-96px, 0px)");
  assert.equal(control.dataset.dragging, "false");
  await pointer(thumb, "pointerdown", 126, 322);
  await pointer(thumb, "pointermove", 180, 340);
  await act(async () => player.app.setMobile(false));
  assert.equal(control.dataset.dragging, "false");
  await pointer(thumb, "pointerup", 180, 340);
  assert.equal(player.app.getSnapshot().navigation.view, "player");
});

test("React mobile slider supports keyboard selection and desktop keeps click navigation", async (t) => {
  const player = await mount(t, { mobile: true });
  const { thumb } = mobileNavigationBounds();
  await click("#mode-toggle");
  await keyboard(thumb, "ArrowRight");
  assert.equal(player.app.getSnapshot().navigation.view, "liked");
  await click("#mode-toggle");
  await keyboard(thumb, "End");
  assert.equal(player.app.getSnapshot().navigation.view, "search");
  await act(async () => player.app.setMobile(false));
  await pointer(thumb, "pointerdown", 222, 322);
  await pointer(thumb, "pointermove", 120, 322);
  await pointer(thumb, "pointerup", 120, 322);
  assert.equal(player.app.getSnapshot().navigation.menuOpen, false);
  await chooseMode("radio");
  assert.equal(player.app.getSnapshot().navigation.view, "browse");
});

test("React home suspends and resumes the mounted page and stage swipes no longer navigate", async (t) => {
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
  await pointer(stage, "pointerup", 100);
  assert.equal(player.app.getSnapshot().navigation.view, "search");
  await click("#home-toggle");
  assert.equal(player.app.getSnapshot().navigation.view, "player");
  assertMobileHomeTarget("搜索歌手", "artist");
  assert.equal(document.querySelector("#search-view").hidden, true);
  await pointer(stage, "pointerdown", 100);
  await pointer(stage, "pointerup", 0);
  assert.equal(player.app.getSnapshot().navigation.view, "player");
  await click("#home-toggle");
  assert.equal(player.app.getSnapshot().navigation.view, "search");
  assert.equal(document.querySelector("#artist-results"), results);
  assert.equal(results.scrollTop, 234);
  assert.equal(document.querySelector("#search-input").value, "周杰伦");
  assert.equal(player.app.getSnapshot().playback.current.id, "a");
  assert.equal(player.requests.filter((request) => request.startsWith("play:")).length, 0);
});

test("React mobile cover swipes preview tracks until the cover or play button is clicked", async (t) => {
  const player = await mount(t, { mobile: true });
  const flow = document.querySelector(".cover-flow");
  const lyrics = document.querySelector("#album-art");
  const title = flow.querySelector(".cover-flow-title");
  const play = document.querySelector("#play-toggle");
  const loads = player.audio.loads;
  Object.defineProperty(flow, "clientWidth", { value: 360 });
  assert.equal(flow.querySelector(".cover-flow-card .cover-flow-title"), null);
  assert.equal(title.textContent, "");
  assert.equal(document.querySelector(".track-meta h1").textContent, "歌曲 a");

  await pointer(lyrics, "pointerdown", 180, 100);
  await pointer(lyrics, "pointermove", 166, 160);
  await pointer(lyrics, "pointerup", 100, 161);
  assert.equal(player.app.getSnapshot().playback.current.id, "a");

  await pointer(lyrics, "pointerdown", 180, 100);
  await pointer(lyrics, "pointermove", 100, 104);
  assert.equal(flow.dataset.dragging, "true");
  assert(Number(flow.style.getPropertyValue("--cover-drag")) < 0);
  await pointer(lyrics, "pointercancel", 100, 104);
  assert.equal(flow.style.getPropertyValue("--cover-drag"), "");
  assert.equal(player.app.getSnapshot().playback.current.id, "a");

  await pointer(lyrics, "pointerdown", 180, 100);
  await pointer(lyrics, "pointermove", 100, 104);
  await pointer(lyrics, "pointerup", 90, 105);
  await act(async () => {
    lyrics.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  });
  assert.equal(player.app.getSnapshot().navigation.view, "player");
  assert.equal(player.app.getSnapshot().playback.current.id, "a");
  assert.equal(player.audio.paused, true);
  assert.equal(player.audio.loads, loads);
  assert.equal(title.textContent, "歌曲 b");
  assert.equal(lyrics.getAttribute("aria-label"), "播放 歌曲 b");
  assert.equal(document.querySelector(".track-meta h1").textContent, "歌曲 a");

  await pointer(lyrics, "pointerdown", 100, 100);
  await pointer(lyrics, "pointerup", 180, 100);
  assert.equal(title.textContent, "");
  await pointer(lyrics, "pointerdown", 100, 100);
  await pointer(lyrics, "pointerup", 180, 100);
  assert.equal(title.textContent, "");
  await keyboard(lyrics, "ArrowRight");
  assert.equal(title.textContent, "歌曲 b");
  await click("#play-toggle");
  assert.equal(player.app.getSnapshot().playback.current.id, "b");
  assert.equal(player.audio.paused, false);
  assert.equal(title.textContent, "");
  assert.equal(play.getAttribute("aria-label"), "暂停");

  const playingLoads = player.audio.loads;
  await keyboard(lyrics, "ArrowRight");
  assert.equal(title.textContent, "歌曲 c");
  assert.equal(player.app.getSnapshot().playback.current.id, "b");
  assert.equal(player.audio.paused, false);
  assert.equal(player.audio.loads, playingLoads);
  assert.equal(play.getAttribute("aria-label"), "播放");
  await pointer(lyrics, "pointerdown", 180, 100);
  await pointer(lyrics, "pointerup", 181, 100);
  await click("#album-art");
  assert.equal(player.app.getSnapshot().navigation.view, "player");
  assert.equal(player.app.getSnapshot().playback.current.id, "c");
  assert.equal(player.audio.paused, false);
  assert.equal(title.textContent, "");
  assert.equal(lyrics.getAttribute("aria-label"), "查看歌词");
  await click("#album-art");
  assert.equal(player.app.getSnapshot().navigation.view, "lyrics");
  assert.equal(document.querySelector("#lyrics-title").textContent, "歌曲 c");
  assert.equal(title.textContent, "");
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
