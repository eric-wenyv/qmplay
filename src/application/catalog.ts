import type { Artist, View } from "../contracts.js";
import { rememberArtist } from "../storage.js";
import type { ApplicationProvider } from "./provider.js";
import type { NavigationController } from "./navigation.js";
import { ApplicationStore, errorMessage } from "./store.js";

interface CatalogEffects {
  save(): void;
  notice(message: string, retry?: () => unknown): void;
}
interface AlbumRequest {
  artist: Artist;
  page: number;
  pending: boolean;
  controller: AbortController;
}

/** Browsing requests own their cancellation and never mutate the playing queue. */
export class CatalogController {
  private searchVersion = 0;
  private searchAbort: AbortController | null = null;
  private followers = new Set<string>();
  private albumRequest: AlbumRequest | null = null;
  private radioVersion = 0;
  private lyricVersion = 0;
  private lyricAbort: AbortController | null = null;
  private lyricId: string | null = null;
  constructor(
    private store: ApplicationStore,
    private provider: ApplicationProvider,
    private navigation: NavigationController,
    private effects: CatalogEffects,
  ) {}
  leave(previous: View, next: View, suspended: boolean): void {
    if (suspended) return;
    if (previous === "search" && next !== "search") this.cancelSearch();
    if (previous === "albums" && next !== "albums") {
      this.albumRequest?.controller.abort();
      if (this.albumRequest) this.albumRequest.pending = false;
      this.store.state.requests.albums = false;
    }
    if (previous === "browse" && next !== "browse") this.radioVersion++;
  }
  cancelSearch(): void {
    this.searchVersion++;
    this.searchAbort?.abort();
    this.followers.clear();
    this.store.state.requests.search = false;
    this.store.publish();
  }
  stop(): void {
    this.cancelSearch();
    this.albumRequest?.controller.abort();
    if (this.albumRequest) this.albumRequest.pending = false;
    this.radioVersion++;
    this.lyricVersion++;
    this.lyricAbort?.abort();
    this.store.state.requests.albums = false;
    this.store.state.requests.lyrics = false;
  }
  showSearch(): void {
    this.navigation.browse("search");
    void this.search("");
  }
  async search(query: string): Promise<void> {
    this.cancelSearch();
    const version = this.searchVersion;
    const controller = (this.searchAbort = new AbortController());
    this.store.state.catalog.query = query;
    if (!query.trim()) {
      this.store.state.catalog.artists = [...this.store.state.catalog.recentArtists];
      this.store.publish();
      return;
    }
    this.store.state.requests.search = true;
    this.store.state.catalog.artists = [];
    this.store.publish();
    try {
      const results = await this.provider.searchArtists(query, {
        signal: controller.signal,
      });
      if (version !== this.searchVersion || !this.navigation.isPageActive("search")) return;
      this.store.state.catalog.artists = results;
      this.store.state.announcement = results.length
        ? `找到 ${results.length} 位歌手`
        : "没有找到歌手";
    } catch (error) {
      if (
        version === this.searchVersion &&
        !controller.signal.aborted &&
        this.navigation.isPageActive("search")
      )
        this.effects.notice(errorMessage(error), () => this.search(query));
    } finally {
      if (version === this.searchVersion) {
        this.store.state.requests.search = false;
        this.store.publish();
      }
    }
  }
  async loadFollowerCount(id: string): Promise<void> {
    const version = this.searchVersion;
    const artists = this.store.state.catalog.artists;
    const artist = artists.find((item) => item.id === id);
    if (!artist || this.followers.has(id)) return;
    this.followers.add(id);
    try {
      const count = await this.provider.getFollowerCount(id, {
        signal: this.searchAbort?.signal,
      });
      if (
        version !== this.searchVersion ||
        !this.navigation.isPageActive("search") ||
        count === null
      )
        return;
      this.store.state.catalog.artists = this.store.state.catalog.artists.map((item) =>
        item.id === id ? { ...item, followerCount: count } : item,
      );
      this.store.publish();
    } catch {
      /* Counts are optional; navigation remains available. */
    }
  }
  async showArtistAlbums(artist: Artist): Promise<void> {
    this.albumRequest?.controller.abort();
    this.navigation.browse("albums");
    this.store.state.catalog.recentArtists = rememberArtist(
      this.store.state.catalog.recentArtists,
      artist,
    );
    this.store.state.catalog.artist = artist;
    this.store.state.catalog.albums = [];
    this.store.state.catalog.hasMoreAlbums = true;
    this.albumRequest = {
      artist,
      page: 0,
      pending: false,
      controller: new AbortController(),
    };
    this.effects.save();
    await this.loadMoreAlbums();
  }
  async loadMoreAlbums(): Promise<void> {
    let request = this.albumRequest;
    if (
      !request ||
      !this.navigation.isPageActive("albums") ||
      request.pending ||
      !this.store.state.catalog.hasMoreAlbums
    )
      return;
    if (request.controller.signal.aborted)
      request = this.albumRequest = {
        ...request,
        controller: new AbortController(),
        pending: false,
      };
    request.pending = true;
    this.store.state.requests.albums = true;
    this.store.publish();
    try {
      const result = await this.provider.getArtistAlbums(request.artist.id, request.page + 1, {
        signal: request.controller.signal,
      });
      if (
        request !== this.albumRequest ||
        request.controller.signal.aborted ||
        !this.navigation.isPageActive("albums")
      )
        return;
      const known = new Set(this.store.state.catalog.albums.map((album) => album.id));
      const added = result.albums.filter((album) => !known.has(album.id));
      if (result.albums.length && !added.length && result.hasMore)
        throw new Error("专辑列表分页未前进，请重试");
      request.page++;
      this.store.state.catalog.hasMoreAlbums = result.hasMore;
      this.store.state.catalog.albums = [...this.store.state.catalog.albums, ...added];
    } catch (error) {
      if (request === this.albumRequest && !request.controller.signal.aborted)
        this.effects.notice(errorMessage(error), () => this.loadMoreAlbums());
    } finally {
      request.pending = false;
      if (request === this.albumRequest && !request.controller.signal.aborted) {
        this.store.state.requests.albums = false;
        this.store.publish();
      }
    }
  }
  async showRadio(): Promise<void> {
    this.navigation.browse("browse");
    const version = ++this.radioVersion;
    const stations = [
      {
        id: "99",
        name: "私人电台／猜你喜欢",
        group: "根据你的听歌喜好推荐",
        coverUrl: "",
      },
      { id: "new", name: "每日新歌", group: "推荐", coverUrl: "" },
    ];
    this.store.state.catalog.stations = stations;
    this.store.publish();
    try {
      const publicStations = await this.provider.getRadioStations();
      if (version !== this.radioVersion || !this.navigation.isPageActive("browse")) return;
      this.store.state.catalog.stations = [...stations, ...publicStations];
      this.store.publish();
    } catch (error) {
      if (version === this.radioVersion && this.navigation.isPageActive("browse"))
        this.effects.notice(errorMessage(error), () => this.showRadio());
    }
  }
  currentChanged(): void {
    this.lyricVersion++;
    this.lyricAbort?.abort();
    this.lyricId = null;
    this.store.state.lyrics = [];
    this.store.state.requests.lyrics = false;
    if (this.store.state.navigation.view === "lyrics") void this.loadLyrics();
  }
  showLyrics(): void {
    if (!this.store.state.playback.current) return;
    this.navigation.setView(this.store.state.navigation.view === "lyrics" ? "player" : "lyrics");
    if (this.store.state.navigation.view === "lyrics") void this.loadLyrics();
  }
  async loadLyrics(): Promise<void> {
    const track = this.store.state.playback.current;
    if (!track || this.store.state.navigation.view !== "lyrics" || this.lyricId === track.id)
      return;
    const version = ++this.lyricVersion;
    this.lyricAbort?.abort();
    const controller = (this.lyricAbort = new AbortController());
    this.store.state.requests.lyrics = true;
    this.store.state.lyrics = [];
    this.store.publish();
    try {
      const lines = await this.provider.getLyrics(track.id, {
        signal: controller.signal,
      });
      if (version !== this.lyricVersion || this.store.state.playback.current?.id !== track.id)
        return;
      this.store.state.lyrics = lines;
      this.lyricId = track.id;
    } catch (error) {
      if (version === this.lyricVersion && this.store.state.playback.current?.id === track.id)
        this.effects.notice(errorMessage(error), () => this.loadLyrics());
    } finally {
      if (version === this.lyricVersion) {
        this.store.state.requests.lyrics = false;
        this.store.publish();
      }
    }
  }
}
