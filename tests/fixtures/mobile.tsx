// Compiled only by layout tests; no live API or account is required.
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { App } from "../../src/ui/App.js";
import { createApplication } from "../../src/application/application.js";

const tracks = Array.from({ length: 24 }, (_, index) => ({
  id: String(index),
  title: [
    "STAND UP!! (Live from the original concert tour)",
    "火力全开",
    "半岛铁盒",
    "She's Got a Way",
    "ad meliora",
    "需要人陪",
  ][index % 6],
  artist: ["etsuco", "王力宏", "周杰伦", "Billy Joel", "The Charm Park", "王力宏"][index % 6],
  duration: 253,
}));
class TestAudio extends EventTarget {
  paused = true;
  ended = false;
  readyState = 1;
  currentTime = 52;
  duration = 253;
  src = "";
  preload = "";
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
const provider = {
  getAuthStatus: async () => ({ authenticated: true, user: { uin: "100" } }),
  getFavorites: async () => tracks,
  getPlayback: async () => "https://music.test/song",
  getRecommendedTracks: async () => tracks,
  getDailyRecommendedTracks: async () => tracks,
  searchArtists: async () => [{ id: "jay", name: "周杰伦", avatarUrl: "", followerCount: null }],
  searchTracks: async () => ({ tracks: tracks.slice(0, 6), hasMore: false }),
  getArtistAlbums: async () => ({ albums: [], hasMore: false }),
  getLyrics: async () => [{ time: 0, text: "让音乐慢慢流动" }],
  setFavorite: async (track) => track,
};
const app = createApplication({
  provider,
  audio: new TestAudio(),
  storage: { getItem: () => null, setItem() {} },
  mobile: true,
  preferences: {
    queue: tracks,
    queueHistory: [{ queue: tracks.slice(1, 7), source: { type: "liked" } }],
    currentId: "0",
    hasQueue: true,
    elapsed: 52,
    accountUin: "100",
    queueSource: { type: "liked" },
  },
});
const root = createRoot(document.getElementById("root")!);
flushSync(() => root.render(<App app={app} />));
Object.assign(window, {
  mobileTest: {
    app,
    flush: (action) => flushSync(action),
    unmount: () => flushSync(() => root.unmount()),
  },
});
