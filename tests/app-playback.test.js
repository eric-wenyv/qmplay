import test from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../src/application/application.js";

const song = (id, extra = {}) => ({ id, title: id, duration: 200, ...extra });
const songs = ["a", "b", "c"].map((id) => song(id));
const artist = (id, name = id) => ({ id, name, avatarUrl: "", followerCount: null });
const album = (id) => ({ id, name: id, publishDate: "", coverUrl: "" });
const settle = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
class Audio extends EventTarget {
  paused = true;
  ended = false;
  readyState = 1;
  currentTime = 0;
  duration = 200;
  preload = "";
  src = "";
  loads = 0;
  listeners = new Map();
  addEventListener(name, fn, options) {
    const values = this.listeners.get(name) || new Set();
    values.add(fn);
    this.listeners.set(name, values);
    super.addEventListener(name, fn, options);
  }
  removeEventListener(name, fn, options) {
    this.listeners.get(name)?.delete(fn);
    super.removeEventListener(name, fn, options);
  }
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
  tick(time) {
    this.currentTime = time;
    this.dispatchEvent(new Event("timeupdate"));
  }
  listenerCount() {
    return [...this.listeners.values()].reduce((count, values) => count + values.size, 0);
  }
}
async function setup(t, preferences = {}, { mobile = false, provider: overrides = {} } = {}) {
  const playbackRequests = [];
  let favorites = [...songs];
  const provider = {
    async getAuthStatus() {
      return { authenticated: true, user: { uin: "100" } };
    },
    async createLoginQr() {
      return { id: "qr", image: "data:image/png;base64,AA==", expiresAt: Date.now() + 60000 };
    },
    async checkLoginQr() {
      return { state: "waiting" };
    },
    async getFavorites() {
      return favorites;
    },
    async setFavorite(track, liked) {
      favorites = favorites.filter((item) => item.id !== track.id);
      if (liked) favorites.push(track);
      return track;
    },
    async getPlayback(track) {
      playbackRequests.push(track.id);
      return `https://music.test/${track.id}`;
    },
    async getRadioStations() {
      return [];
    },
    async getRecommendedTracks() {
      return [song("radio")];
    },
    async getRadioTracks() {
      return [...songs];
    },
    async getArtistTrackPage() {
      return { tracks: [...songs], hasMore: false };
    },
    async getAlbumTrackPage() {
      return { tracks: [...songs], hasMore: false };
    },
    async getArtistAlbums() {
      return { albums: [album("album")], hasMore: false };
    },
    async searchArtists() {
      return [];
    },
    async getFollowerCount() {
      return null;
    },
    async getLyrics() {
      return [];
    },
    ...overrides,
  };
  const values = new Map();
  const saved = [];
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem(key, value) {
      values.set(key, value);
      if (key === "qmplay-library-v2") saved.push(JSON.parse(value));
    },
  };
  const audio = new Audio();
  const app = createApplication({
    provider,
    audio,
    storage,
    mobile,
    preferences: { queue: [], liked: [], hasQueue: true, ...preferences },
  });
  t.after(() => app.stop());
  await app.start();
  await settle();
  return {
    app,
    provider,
    audio,
    saved,
    playbackRequests,
    storage,
    setFavorites(tracks) {
      favorites = tracks;
    },
  };
}

test("restoration preserves an edited queue and progress independently of cloud favorites", async (t) => {
  const { app, audio, saved } = await setup(t, {
    queue: [songs[2], songs[0]],
    currentId: "a",
    elapsed: 42,
    queueSource: { type: "liked" },
  });
  assert.deepEqual(
    app.getSnapshot().playback.queue.map((track) => track.id),
    ["c", "a"],
  );
  assert.equal(app.session.current.id, "a");
  assert.equal(app.session.elapsed, 42);
  assert.equal(audio.paused, true);
  assert.equal(app.transport.pendingSeek, 42);
  assert.equal(saved.at(-1).queueSource.type, "liked");
});

test("an explicitly cleared saved queue never triggers a replacement playlist", async (t) => {
  const { app } = await setup(
    t,
    { queue: [], queueSource: null },
    {
      provider: {
        getRecommendedTracks() {
          assert.fail("must not fetch an explicitly empty queue");
        },
      },
    },
  );
  assert.equal(app.getSnapshot().playback.current, null);
});

for (const mobile of [false, true]) {
  test(`personal radio remains first and continues with subsequent batches (${mobile ? "mobile" : "desktop"})`, async (t) => {
    const { app, provider, audio } = await setup(t, {}, { mobile });
    await app.switchSource("liked");
    app.seek(35);
    const requests = [];
    provider.getRadioStations = async () => [
      { id: "42", name: "公共电台", group: "分类", coverUrl: "" },
    ];
    provider.getRadioTracks = async (id, firstplay, { signal }) => {
      requests.push({ id, firstplay, signal });
      return firstplay ? [...songs] : [song("next-personal")];
    };
    await app.showRadio();
    assert.deepEqual(
      app.getSnapshot().catalog.stations.map((station) => station.id),
      ["99", "new", "42"],
    );
    assert.equal(app.session.elapsed, 35);
    assert.equal(audio.paused, false);
    assert.equal(requests.length, 0);
    await app.switchSource("radio", { id: "99" });
    await app.selectTrack(2);
    await app.advance("next", true);
    assert.deepEqual(
      requests.map(({ id, firstplay }) => [id, firstplay]),
      [
        ["99", 1],
        ["99", 0],
      ],
    );
    assert.equal(app.session.current.id, "next-personal");
  });
}

test("personal radio and new songs remain available when the public catalogue fails", async (t) => {
  const { app } = await setup(
    t,
    {},
    {
      provider: {
        async getRadioStations() {
          throw new Error("公共频道暂时不可用");
        },
      },
    },
  );
  await app.showRadio();
  assert.deepEqual(
    app.getSnapshot().catalog.stations.map((station) => station.id),
    ["99", "new"],
  );
  assert.equal(app.getSnapshot().notice.message, "公共频道暂时不可用");
  await app.switchSource("radio", { id: "99" });
  assert.equal(app.session.current.id, "a");
});

for (const type of ["artist", "radio", "liked"])
  for (const playbackState of ["playing", "paused", "buffering"]) {
    test(`browsing preserves the ${type} queue while ${playbackState}`, async (t) => {
      const { app, provider, audio, playbackRequests } = await setup(t);
      await app.switchSource(type, type === "liked" ? null : { id: "42" });
      await app.selectTrack(1);
      app.seek(47);
      app.removeTrack(2);
      const queue = app.session.queue,
        history = app.session.history,
        source = app.session.source;
      let pending, playback;
      if (playbackState === "paused") app.pause();
      if (playbackState === "buffering") {
        playback = deferred();
        provider.getPlayback = () => playback.promise;
        pending = app.transport.select(app.session.current, { autoplay: true, elapsed: 47 });
      }
      const loads = audio.loads,
        version = app.transport.version,
        count = playbackRequests.length;
      for (const browse of [() => app.showLiked(), () => app.showSearch(), () => app.showRadio()]) {
        await browse();
        app.returnToPlayer();
        app.showLyrics();
        await settle();
        app.returnToPlayer();
        assert.equal(app.session.queue, queue);
        assert.equal(app.session.history, history);
        assert.equal(app.session.source, source);
        assert.equal(app.session.current.id, "b");
        assert.equal(app.session.elapsed, 47);
        assert.equal(audio.loads, loads);
        assert.equal(app.transport.version, version);
        assert.equal(playbackRequests.length, count);
        assert.equal(app.transport.desiredPlaying, playbackState !== "paused");
        assert.equal(audio.paused, playbackState !== "playing");
      }
      if (pending) {
        playback.resolve("https://music.test/b");
        await pending;
        assert.equal(audio.paused, false);
      }
    });
  }

test("browsing favorites cancels a pending playlist selection and preserves current progress", async (t) => {
  const { app, provider, audio } = await setup(t);
  await app.switchSource("liked");
  app.seek(41);
  const tracks = deferred();
  provider.getRecommendedTracks = () => tracks.promise;
  const pending = app.switchSource("radio", { id: "new" });
  app.showLiked();
  tracks.resolve([song("other")]);
  await pending;
  assert.equal(app.session.current.id, "a");
  assert.equal(app.session.elapsed, 41);
  assert.equal(audio.paused, false);
});

test("explicit favorite selection replaces the queue; an empty library leaves current playback intact", async (t) => {
  const { app, audio, setFavorites } = await setup(t);
  await app.switchSource("radio", { id: "new" });
  app.showLiked();
  await app.switchSource("liked", null, { trackId: "c" });
  assert.equal(app.session.current.id, "c");
  assert.equal(app.getSnapshot().navigation.view, "player");
  setFavorites([]);
  await app.refreshFavorites();
  app.seek(31);
  await app.switchSource("liked");
  assert.equal(app.session.current.id, "c");
  assert.equal(app.session.elapsed, 31);
  assert.equal(audio.paused, false);
});

test("radio batch loading survives navigation but ignores responses for replaced queues", async (t) => {
  const { app, provider } = await setup(t);
  await app.switchSource("radio", { id: "42" });
  await app.selectTrack(2);
  const tracks = deferred();
  provider.getRadioTracks = () => tracks.promise;
  const pending = app.advance("next", true);
  app.showLiked();
  tracks.resolve([song("next")]);
  await pending;
  assert.equal(app.getSnapshot().navigation.view, "liked");
  assert.equal(app.session.current.id, "next");
  const old = deferred();
  provider.getRadioTracks = () => old.promise;
  const stale = app.loadMore();
  await app.switchSource("liked");
  old.resolve([song("stale")]);
  assert.equal(await stale, false);
  assert.deepEqual(
    app.session.queue.map((track) => track.id),
    ["a", "b", "c"],
  );
});

for (const type of ["artist", "album"]) {
  test(`${type} pagination loads beyond 1000 songs, merges requests and stops at the final page`, async (t) => {
    const queue = Array.from({ length: 1000 }, (_, index) => song(`song${index}`));
    const { app, provider, audio } = await setup(t, {
      queue,
      currentId: "song999",
      queueSource: { type, resource: { id: "mid" }, page: 20, hasMore: true },
    });
    const page = deferred();
    let calls = 0;
    provider[type === "artist" ? "getArtistTrackPage" : "getAlbumTrackPage"] = (id, number) => {
      assert.equal(id, "mid");
      assert.equal(number, 21);
      calls++;
      return page.promise;
    };
    const next = app.advance("next", true),
      duplicate = app.loadMore();
    assert.equal(calls, 1);
    page.resolve({ tracks: [song("song999"), song("song1000")], hasMore: false });
    await Promise.all([next, duplicate]);
    assert.equal(app.session.queue.length, 1001);
    assert.equal(app.session.current.id, "song1000");
    assert.equal(app.session.source.page, 21);
    assert.equal(app.session.source.hasMore, false);
    assert.equal(audio.paused, false);
    assert.equal(await app.loadMore(), false);
    assert.equal(calls, 1);
    await app.advance("next");
    assert.equal(app.session.current.id, "song0");
  });
}

test("catalogue prefetch near the tail keeps playing and remembers the page cursor", async (t) => {
  const tracks = Array.from({ length: 50 }, (_, index) => song(`track${index}`));
  const pages = [];
  const { app, audio } = await setup(
    t,
    {},
    {
      provider: {
        async getArtistTrackPage(_id, page) {
          pages.push(page);
          return page === 1
            ? { tracks, hasMore: true }
            : { tracks: [song("next")], hasMore: false };
        },
      },
    },
  );
  await app.switchSource("artist", { id: "singer" });
  assert.deepEqual(pages, [1]);
  await app.selectTrack(44);
  await settle();
  assert.deepEqual(pages, [1, 2]);
  assert.equal(app.session.current.id, "track44");
  assert.equal(app.session.queue.length, 51);
  assert.equal(audio.paused, false);
});

test("failed pages retain the cursor and song until retry succeeds", async (t) => {
  const { app, provider } = await setup(t, {
    queue: songs,
    currentId: "c",
    queueSource: { type: "artist", resource: { id: "singer" }, page: 1, hasMore: true },
  });
  provider.getArtistTrackPage = async () => {
    throw new Error("暂时无法连接");
  };
  await app.advance("next", true);
  assert.equal(app.session.current.id, "c");
  assert.equal(app.session.source.page, 1);
  provider.getArtistTrackPage = async () => ({ tracks: [song("next")], hasMore: false });
  await app.advance("next", true);
  assert.equal(app.session.current.id, "next");
  assert.equal(app.session.source.page, 2);
});

test("duplicate-only pages advance to fresh songs with a bound on requests", async (t) => {
  const { app, provider } = await setup(t, {
    queue: songs,
    queueSource: { type: "artist", resource: { id: "singer" }, page: 1, hasMore: true },
  });
  let calls = 0;
  provider.getArtistTrackPage = async (_id, page) => {
    calls++;
    return { tracks: page === 2 ? songs : [song("fresh")], hasMore: page === 2 };
  };
  assert.equal(await app.loadMore(), true);
  assert.equal(calls, 2);
  assert.equal(app.session.source.page, 3);
  provider.getArtistTrackPage = async () => {
    calls++;
    return { tracks: songs, hasMore: true };
  };
  await app.switchSource("artist", { id: "singer" }, { autoplay: false });
  assert.equal(await app.loadMore(), false);
  assert.equal(calls, 6);
});

test("previous or pause during a pending next prevents a late selection jump", async (t) => {
  for (const action of ["previous", "pause"]) {
    const { app, provider } = await setup(t, {
      queue: songs,
      currentId: "c",
      queueSource: { type: "artist", resource: { id: "singer" }, page: 1, hasMore: true },
    });
    const page = deferred();
    provider.getArtistTrackPage = () => page.promise;
    const next = app.advance("next");
    if (action === "previous") await app.advance("previous");
    else app.pause();
    const expected = app.session.current.id;
    page.resolve({ tracks: [song("fresh")], hasMore: false });
    await next;
    assert.equal(app.session.current.id, expected);
    assert.equal(app.session.queue.length, 4);
  }
});

test("a new queue can load while a cancelled old batch is pending", async (t) => {
  const { app, provider } = await setup(t);
  await app.switchSource("radio", { id: "42" });
  const old = deferred();
  provider.getRadioTracks = () => old.promise;
  const oldBatch = app.loadMore();
  await app.switchSource("artist", { id: "singer" }, { autoplay: false });
  const fresh = deferred();
  provider.getArtistTrackPage = () => fresh.promise;
  // The first page was terminal, so use an explicit nonterminal queue instead.
  await app.switchSource("liked");
  provider.getArtistTrackPage = async () => ({ tracks: songs, hasMore: true });
  await app.switchSource("artist", { id: "singer" }, { autoplay: false });
  provider.getArtistTrackPage = () => fresh.promise;
  const newBatch = app.loadMore();
  old.resolve([song("stale")]);
  assert.equal(await oldBatch, false);
  fresh.resolve({ tracks: [song("fresh")], hasMore: false });
  assert.equal(await newBatch, true);
  assert.deepEqual(
    app.session.queue.map((track) => track.id),
    ["a", "b", "c", "fresh"],
  );
});

test("favorite sync and unliking preserve edited playback queue and progress", async (t) => {
  const { app, audio, setFavorites } = await setup(t);
  await app.switchSource("liked");
  await app.selectTrack(1);
  app.seek(53);
  app.removeTrack(2);
  const queue = app.session.queue,
    history = app.session.history,
    loads = audio.loads;
  setFavorites([songs[1], song("new-favorite")]);
  app.showLiked();
  await app.refreshFavorites();
  await app.toggleLike();
  assert.deepEqual(
    app.getSnapshot().library.liked.map((track) => track.id),
    ["new-favorite"],
  );
  assert.equal(app.session.queue, queue);
  assert.equal(app.session.history, history);
  assert.equal(app.session.current.id, "b");
  assert.equal(app.session.elapsed, 53);
  assert.equal(audio.loads, loads);
  assert.equal(audio.paused, false);
});

test("clearing a search restores history and ignores late results", async (t) => {
  const history = [artist("recent")];
  const { app, provider } = await setup(t, { artistHistory: history });
  app.showSearch();
  assert.deepEqual(
    app.getSnapshot().catalog.artists.map((item) => item.id),
    ["recent"],
  );
  const search = deferred();
  provider.searchArtists = () => search.promise;
  const stale = app.search("old");
  await app.search("");
  search.resolve([artist("stale")]);
  await stale;
  assert.deepEqual(
    app.getSnapshot().catalog.artists.map((item) => item.id),
    ["recent"],
  );
  assert.equal(app.getSnapshot().requests.search, false);
});

test("concurrent follower counts preserve every completed artist count", async (t) => {
  const { app, provider } = await setup(t);
  app.showSearch();
  provider.searchArtists = async () => [artist("one"), artist("two")];
  await app.search("singer");
  const one = deferred(),
    two = deferred();
  provider.getFollowerCount = (id) => (id === "one" ? one.promise : two.promise);
  const pending = [app.loadFollowerCount("one"), app.loadFollowerCount("two")];
  one.resolve(10);
  await settle();
  two.resolve(20);
  await Promise.all(pending);
  assert.deepEqual(
    app.getSnapshot().catalog.artists.map((item) => item.followerCount),
    [10, 20],
  );
});

test("browsing albums records history without replacing the playing source", async (t) => {
  const { app, audio, saved } = await setup(t, { artistHistory: [artist("old")] });
  await app.switchSource("liked");
  app.seek(42);
  const queue = app.session.queue,
    loads = audio.loads;
  await app.showArtistAlbums(artist("singer"));
  assert.equal(app.getSnapshot().navigation.view, "albums");
  assert.equal(app.session.queue, queue);
  assert.equal(app.session.elapsed, 42);
  assert.equal(audio.loads, loads);
  assert.deepEqual(
    saved.at(-1).artistHistory.map((item) => item.id),
    ["singer", "old"],
  );
  await app.switchSource("album", album("album"));
  assert.equal(app.session.source.type, "album");
});

test("album pagination coalesces calls and cancels stale responses when another page is chosen", async (t) => {
  const { app, provider } = await setup(t);
  const page = deferred();
  let calls = 0,
    signal;
  provider.getArtistAlbums = async (_id, number, options) => {
    calls++;
    signal = options.signal;
    return number === 1 ? { albums: [album("one")], hasMore: true } : page.promise;
  };
  await app.showArtistAlbums(artist("singer"));
  const pending = app.loadMoreAlbums();
  await app.loadMoreAlbums();
  assert.equal(calls, 2);
  app.showSearch();
  assert.equal(signal.aborted, true);
  page.resolve({ albums: [album("stale")], hasMore: false });
  await pending;
  assert.deepEqual(
    app.getSnapshot().catalog.albums.map((item) => item.id),
    ["one"],
  );
});

for (const pageName of ["search", "albums", "browse"]) {
  test(`mobile ${pageName} requests survive suspension at the player`, async (t) => {
    const { app, provider } = await setup(t, {}, { mobile: true });
    const result = deferred();
    let pending;
    if (pageName === "search") {
      app.showSearch();
      provider.searchArtists = () => result.promise;
      pending = app.search("singer");
    }
    if (pageName === "albums") {
      provider.getArtistAlbums = () => result.promise;
      pending = app.showArtistAlbums(artist("singer"));
    }
    if (pageName === "browse") {
      provider.getRadioStations = () => result.promise;
      pending = app.showRadio();
    }
    app.returnToPlayer();
    result.resolve(
      pageName === "search"
        ? [artist("found")]
        : pageName === "albums"
          ? { albums: [album("found")], hasMore: false }
          : [{ id: "42", name: "found", group: "", coverUrl: "" }],
    );
    await pending;
    app.resumeMobilePage();
    assert.equal(app.getSnapshot().navigation.view, pageName);
    const catalog = app.getSnapshot().catalog;
    assert(
      pageName === "search"
        ? catalog.artists.some((item) => item.id === "found")
        : pageName === "albums"
          ? catalog.albums.some((item) => item.id === "found")
          : catalog.stations.some((item) => item.id === "42"),
    );
  });
}

test("mobile queue is a page; responsive transitions preserve playback and close menu modality", async (t) => {
  const { app } = await setup(t, {}, { mobile: true });
  await app.switchSource("liked");
  app.seek(24);
  app.showSearch();
  app.returnToPlayer();
  assert.equal(app.getSnapshot().navigation.mobileMode, "artist");
  app.resumeMobilePage();
  assert.equal(app.getSnapshot().navigation.view, "search");
  app.openQueue();
  assert.equal(app.getSnapshot().navigation.view, "queue");
  app.setMenu(true);
  app.setMobile(false);
  assert.equal(app.getSnapshot().navigation.view, "player");
  assert.equal(app.getSnapshot().navigation.queueOpen, true);
  assert.equal(app.getSnapshot().navigation.menuOpen, false);
  assert.equal(app.session.elapsed, 24);
  app.setMobile(true);
  assert.equal(app.getSnapshot().navigation.view, "queue");
  await app.selectTrack(1);
  assert.equal(app.getSnapshot().navigation.view, "player");
});

test("lyrics always follow the newly selected song and ignore stale lyric requests", async (t) => {
  const { app, provider } = await setup(t);
  await app.switchSource("liked");
  const first = deferred(),
    second = deferred();
  const requests = [];
  provider.getLyrics = (id) => {
    requests.push(id);
    return id === "a" ? first.promise : second.promise;
  };
  app.showLyrics();
  await app.advance("next");
  assert.deepEqual(requests, ["a", "b"]);
  first.resolve([{ time: 0, text: "old" }]);
  second.resolve([{ time: 0, text: "new" }]);
  await settle();
  assert.deepEqual(app.getSnapshot().lyrics, [{ time: 0, text: "new" }]);
});

test("snapshot values are immutable and unrelated collections retain identity across progress", async (t) => {
  const { app, audio } = await setup(t);
  await app.switchSource("liked");
  app.showSearch();
  const before = app.getSnapshot();
  assert.equal(before, app.getSnapshot());
  assert.throws(() => before.playback.queue.push(song("illegal")), TypeError);
  assert.throws(() => {
    before.playback.current.title = "illegal";
  }, TypeError);
  audio.tick(14);
  const after = app.getSnapshot();
  assert.notEqual(after, before);
  assert.equal(after.playback.elapsed, 14);
  assert.equal(before.playback.elapsed, 0);
  assert.equal(after.playback.queue, before.playback.queue);
  assert.equal(after.playback.current, before.playback.current);
  assert.equal(after.catalog, before.catalog);
  assert.equal(after.library, before.library);
});

test("stop removes media listeners, ignores stale requests and resumes without duplicate listeners", async (t) => {
  const { app, audio, provider } = await setup(t);
  await app.switchSource("liked");
  const count = audio.listenerCount();
  assert(count > 0);
  app.showSearch();
  const search = deferred();
  provider.searchArtists = () => search.promise;
  const pending = app.search("old");
  app.stop();
  assert.equal(audio.listenerCount(), 0);
  const stopped = app.getSnapshot();
  audio.tick(70);
  assert.equal(app.getSnapshot(), stopped);
  search.resolve([artist("stale")]);
  await pending;
  assert.equal(app.getSnapshot().catalog.artists.length, 0);
  await app.start();
  assert.equal(audio.listenerCount(), count);
  audio.tick(19);
  assert.equal(app.getSnapshot().playback.elapsed, 19);
  await app.start();
  assert.equal(audio.listenerCount(), count);
});

test("authentication refresh keeps valid playback on network errors and isolates account changes", async (t) => {
  const { app, provider, audio } = await setup(t);
  await app.switchSource("liked");
  app.seek(21);
  provider.getAuthStatus = async () => {
    throw new Error("offline");
  };
  await app.refreshFavorites();
  assert.equal(app.getSnapshot().auth.state, "ready");
  assert.equal(audio.paused, false);
  assert.equal(app.session.elapsed, 21);
  provider.getAuthStatus = async () => ({ authenticated: true, user: { uin: "200" } });
  provider.getFavorites = async () => [song("new-account")];
  await app.refreshFavorites();
  await settle();
  assert.equal(app.getSnapshot().auth.user.uin, "200");
  assert.deepEqual(
    app.getSnapshot().library.liked.map((track) => track.id),
    ["new-account"],
  );
  assert(!app.session.queue.some((track) => track.id === "a"));
  assert.equal(audio.paused, true);
});

test("suspension ignores late playback pages, album pages and favorite mutations", async (t) => {
  for (const kind of ["queue", "albums", "favorite"]) {
    const { app, provider } = await setup(t, {
      queue: songs,
      queueSource: { type: "artist", resource: { id: "singer" }, page: 1, hasMore: true },
    });
    const result = deferred();
    let pending;
    if (kind === "queue") {
      provider.getArtistTrackPage = () => result.promise;
      pending = app.loadMore();
    }
    if (kind === "albums") {
      provider.getArtistAlbums = () => result.promise;
      pending = app.showArtistAlbums(artist("singer"));
    }
    if (kind === "favorite") {
      provider.setFavorite = () => result.promise;
      pending = app.toggleLike();
      await settle();
    }
    app.stop();
    const stopped = app.getSnapshot();
    result.resolve(
      kind === "queue"
        ? { tracks: [song("stale")], hasMore: false }
        : kind === "albums"
          ? { albums: [album("stale")], hasMore: false }
          : songs[0],
    );
    await pending;
    assert.equal(app.getSnapshot(), stopped, `${kind} may not publish after stop`);
  }
});

test("metadata duration updates preserve an in-flight page and its pending next selection", async (t) => {
  const { app, provider, audio } = await setup(t, {
    queue: songs,
    currentId: "c",
    queueSource: { type: "artist", resource: { id: "singer" }, page: 1, hasMore: true },
  });
  const page = deferred();
  provider.getArtistTrackPage = () => page.promise;
  const pending = app.advance("next", true);
  audio.duration = 220;
  audio.tick(12);
  page.resolve({ tracks: [song("next")], hasMore: false });
  await pending;
  assert.equal(app.session.current.id, "next");
  assert.equal(app.session.queue.find((track) => track.id === "c").duration, 220);
});
