import { Authentication } from "../auth.js";
import { FavoriteSync } from "../favorites.js";
import { readLibrary, writeLibrary } from "../storage.js";
import type { AudioElementLike } from "../audio.js";
import type {
  AppSnapshot,
  Artist,
  Library,
  MusicApplication,
  Resource,
  SourceType,
  StorageLike,
  User,
  View,
} from "../contracts.js";
import type { ApplicationProvider } from "./provider.js";
import { CatalogController } from "./catalog.js";
import { NavigationController, initialMobileMode } from "./navigation.js";
import { PlaybackController } from "./playback.js";
import { ApplicationStore, errorCode, errorMessage } from "./store.js";

export interface ApplicationOptions {
  provider: ApplicationProvider;
  audio: AudioElementLike;
  storage: StorageLike;
  preferences?: Partial<Library>;
  mobile?: boolean;
  now?: () => number;
}

/** Composition root for feature controllers. No DOM or platform APIs are required. */
export class Application implements MusicApplication {
  private store: ApplicationStore;
  private navigation: NavigationController;
  private catalog: CatalogController;
  private playback: PlaybackController;
  private authentication: Authentication;
  private favorites: FavoriteSync;
  private preferences: Library;
  private activeUser: User | null = null;
  private running = false;
  private playerStarted = false;
  private storageWarning = false;
  private refreshInFlight: Promise<void> | null = null;
  private lastRefresh = 0;
  private generation = 0;
  private now: () => number;

  constructor(private options: ApplicationOptions) {
    this.now = options.now || Date.now;
    this.preferences = {
      ...readLibrary(options.storage),
      ...options.preferences,
    };
    const preferences = this.preferences;
    const state: AppSnapshot = {
      playback: {
        current: null,
        queue: [],
        index: 0,
        elapsed: 0,
        playing: false,
        desiredPlaying: false,
        loading: false,
        order: preferences.order,
        source: preferences.queueSource,
      },
      navigation: {
        view: "player",
        mobile: !!options.mobile,
        mobilePage: null,
        mobileMode: initialMobileMode(preferences.queueSource?.type),
        menuOpen: false,
        queueOpen: false,
      },
      auth: { state: "checking", message: "正在恢复登录…" },
      catalog: {
        query: "",
        artists: [],
        recentArtists: preferences.artistHistory,
        artist: null,
        albums: [],
        stations: [],
        hasMoreAlbums: false,
      },
      library: { liked: [], busyIds: [] },
      requests: {
        source: false,
        search: false,
        albums: false,
        lyrics: false,
        more: false,
      },
      lyrics: [],
      notice: null,
      announcement: "",
    };
    this.store = new ApplicationStore(state);
    this.navigation = new NavigationController(
      this.store,
      (previous, next, suspended) => this.catalog?.leave(previous, next, suspended),
      () => this.playback?.cancelSource(),
    );
    this.catalog = new CatalogController(this.store, options.provider, this.navigation, {
      save: () => this.savePreferences(),
      notice: (message, retry) => this.notice(message, retry),
    });
    this.playback = new PlaybackController(
      this.store,
      options.provider,
      options.audio,
      this.navigation,
      {
        save: () => this.savePreferences(),
        notice: (message, retry) => this.notice(message, retry),
        currentChanged: () => this.catalog.currentChanged(),
        now: this.now,
      },
    );
    this.favorites = new FavoriteSync({
      provider: options.provider,
      storage: options.storage,
      legacy: preferences.liked,
      legacyAccount: preferences.accountUin,
      onChange: (tracks) => {
        this.store.state.library.liked = tracks;
        this.store.publish();
      },
    });
    this.authentication = new Authentication({
      provider: options.provider,
      onState: (auth) => {
        if (!this.running) return;
        this.store.state.auth = auth;
        if (auth.state === "ready" && !this.playerStarted) {
          this.playerStarted = true;
          this.playback.restore(this.preferences);
        }
        this.store.publish();
      },
      onAuthenticated: (user) => this.authenticated(user),
    });
    options.provider.onAuthenticationRequired = () => {
      if (!this.running) return;
      this.playback.pause();
      this.favorites.disconnect();
      void this.authentication.start();
    };
  }
  readonly getSnapshot = (): AppSnapshot => this.store.getSnapshot();
  readonly subscribe = (listener: () => void): (() => void) => this.store.subscribe(listener);
  /** Exposed for transport integrations and focused domain tests, never mutated by React. */
  get session() {
    return this.playback.session;
  }
  get transport() {
    return this.playback.transport;
  }
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.generation++;
    this.transport.resume();
    await this.authentication.start();
  }
  stop(): void {
    if (!this.running) return;
    this.savePreferences();
    this.running = false;
    this.generation++;
    this.authentication.stop();
    this.catalog.stop();
    this.playback.stop();
    // In-flight account requests must not publish after suspension or into the next start.
    this.favorites.disconnect();
    this.store.state.library.busyIds = [];
    this.refreshInFlight = null;
    this.store.publish();
  }
  private async authenticated(user: User): Promise<void> {
    if (!this.running) return;
    const previous = this.activeUser?.uin || this.preferences.accountUin;
    this.activeUser = user;
    if (previous && previous !== user.uin) {
      this.catalog.stop();
      this.playback.reset();
      Object.assign(this.preferences, {
        queue: [],
        currentId: "",
        elapsed: 0,
        hasQueue: false,
        queueSource: {
          type: "radio",
          resource: { id: "new", name: "每日新歌" },
        },
      });
      this.store.state.catalog.artists = [];
      this.store.state.catalog.albums = [];
      this.store.state.catalog.artist = null;
      this.store.state.lyrics = [];
      this.playerStarted = false;
    }
    this.favorites.connect(user.uin);
    try {
      await this.favorites.sync();
    } catch (error) {
      if (errorCode(error) === "AUTH_REQUIRED") throw error;
      if (this.running)
        this.notice(`收藏同步失败：${errorMessage(error)}`, () => this.refreshFavorites());
    }
  }
  savePreferences(): void {
    const session = this.playback?.session;
    if (!session || !this.playerStarted) return;
    const success = writeLibrary(
      {
        liked: this.activeUser ? this.store.state.library.liked : this.preferences.liked,
        accountUin: this.activeUser?.uin || this.preferences.accountUin || "",
        order: session.order,
        queue: session.queue,
        currentId: session.current?.id,
        elapsed: session.elapsed,
        queueSource: session.source,
        artistHistory: this.store.state.catalog.recentArtists,
      },
      this.options.storage,
    );
    if (!success && !this.storageWarning) {
      this.storageWarning = true;
      this.notice("本机存储空间不足，当前更改无法保存到下次启动");
    }
  }
  private notice(message: string, retry?: () => unknown): void {
    this.store.state.notice = { message, retry: retry || null };
    this.store.state.announcement = message;
    this.store.publish();
  }
  dismissNotice(): void {
    this.store.state.notice = null;
    this.store.publish();
  }
  async retryAuthentication(): Promise<void> {
    if (!this.running) {
      await this.start();
      return;
    }
    if (this.store.state.auth.state === "unavailable") await this.authentication.start();
    else await this.authentication.login();
  }
  async refreshFavorites(): Promise<void> {
    if (!this.running || this.store.state.auth.state !== "ready") return;
    if (this.refreshInFlight) return this.refreshInFlight;
    const generation = this.generation;
    const work = async () => {
      try {
        const status = await this.options.provider.getAuthStatus();
        if (generation !== this.generation || !this.running) return;
        if (!status.authenticated) {
          this.options.provider.onAuthenticationRequired?.();
          return;
        }
        if (status.user?.uin !== this.activeUser?.uin) {
          await this.authentication.start();
          return;
        }
        await this.favorites.sync();
        if (generation === this.generation && this.running) this.savePreferences();
      } catch (error) {
        if (generation === this.generation && this.running && errorCode(error) !== "AUTH_REQUIRED")
          this.notice(`收藏同步失败：${errorMessage(error)}`, () => this.refreshFavorites());
      } finally {
        if (generation === this.generation) {
          this.lastRefresh = this.now();
          this.refreshInFlight = null;
        }
      }
    };
    this.refreshInFlight = work();
    return this.refreshInFlight;
  }
  async toggleLike(): Promise<void> {
    const track = this.session.current;
    if (
      !track ||
      !this.running ||
      this.store.state.auth.state !== "ready" ||
      this.favorites.busy.has(track.id)
    )
      return;
    const generation = this.generation;
    const removing = this.store.state.library.liked.some((item) => item.id === track.id);
    const work = this.favorites.set(track, !removing);
    this.store.state.library.busyIds = [...this.favorites.busy];
    this.store.publish();
    try {
      if (!(await work) || generation !== this.generation) return;
      this.savePreferences();
      this.store.state.announcement = removing ? "已取消喜欢并同步" : "已收藏并同步到 QQ 音乐";
    } catch (error) {
      if (generation === this.generation && errorCode(error) !== "AUTH_REQUIRED")
        this.notice(errorMessage(error), () => this.refreshFavorites());
    } finally {
      if (generation === this.generation && this.running) {
        this.store.state.library.busyIds = [...this.favorites.busy];
        this.store.publish();
      }
    }
  }
  setMobile(mobile: boolean): void {
    this.navigation.setMobile(mobile);
  }
  setMenu(open: boolean): void {
    this.navigation.setMenu(open);
  }
  setView(view: View): void {
    this.navigation.setView(view);
    if (view === "lyrics") void this.catalog.loadLyrics();
  }
  returnToPlayer(): void {
    this.navigation.returnToPlayer();
  }
  resumeMobilePage(): void {
    this.navigation.resumeMobilePage();
    if (this.store.state.navigation.view === "lyrics") void this.catalog.loadLyrics();
  }
  showSearch(): void {
    this.catalog.showSearch();
  }
  search(query: string): Promise<void> {
    return this.catalog.search(query);
  }
  cancelSearch(): void {
    this.catalog.cancelSearch();
  }
  loadFollowerCount(id: string): Promise<void> {
    return this.catalog.loadFollowerCount(id);
  }
  showArtistAlbums(artist: Artist): Promise<void> {
    return this.catalog.showArtistAlbums(artist);
  }
  loadMoreAlbums(): Promise<void> {
    return this.catalog.loadMoreAlbums();
  }
  showRadio(): Promise<void> {
    return this.catalog.showRadio();
  }
  showLiked(): void {
    this.navigation.browse("liked");
  }
  switchSource(
    type: SourceType,
    resource?: Resource | null,
    options?: { autoplay?: boolean; trackId?: string },
  ): Promise<void> {
    return this.playback.switchSource(type, resource, options);
  }
  togglePlay(): void {
    this.playback.togglePlay();
  }
  play(): Promise<void> {
    return this.playback.play();
  }
  pause(): void {
    this.playback.pause();
  }
  seek(seconds: number): void {
    this.playback.seek(seconds);
  }
  advance(direction: "next" | "previous", automatic?: boolean): Promise<void> {
    return this.playback.advance(direction, automatic);
  }
  cycleOrder(): void {
    this.playback.cycleOrder();
  }
  openQueue(): void {
    this.navigation.openQueue();
  }
  closeQueue(): void {
    this.navigation.closeQueue();
  }
  selectTrack(index: number): Promise<void> {
    return this.playback.selectTrack(index);
  }
  removeTrack(index: number): void {
    this.playback.removeTrack(index);
  }
  loadMore(options?: { quiet?: boolean }): Promise<boolean> {
    return this.playback.loadMore(options);
  }
  showLyrics(): void {
    this.catalog.showLyrics();
  }
}

export function createApplication(options: ApplicationOptions): Application {
  return new Application(options);
}
