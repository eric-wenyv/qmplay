import type { Album, Artist, View } from "../contracts.js";
import { rememberArtist } from "../storage.js";
import type { ApplicationProvider } from "./provider.js";
import type { NavigationController } from "./navigation.js";
import { ApplicationStore, errorMessage } from "./store.js";

interface CatalogEffects {
  save(): void;
  reportError(message: string, retry: () => unknown): void;
}
interface AlbumRequest {
  artist: Artist;
  page: number;
  pending: boolean;
  controller: AbortController;
}
interface AlbumTrackRequest {
  album: Album;
  page: number;
  pending: boolean;
  controller: AbortController;
}

/** Browsing requests own their cancellation and never mutate the playing queue. */
export class CatalogController {
  private searchVersion = 0;
  private searchAbort: AbortController | null = null;
  private trackSearchVersion = 0;
  private trackSearchAbort: AbortController | null = null;
  private trackSearchPage = 0;
  private followers = new Set<string>();
  private albumRequest: AlbumRequest | null = null;
  private albumTrackRequest: AlbumTrackRequest | null = null;
  private lyricVersion = 0;
  private lyricAbort: AbortController | null = null;
  private lyricId: string | null = null;
  private inlineLyrics = false;
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
    if (previous === "albumTracks" && next !== "albumTracks") this.cancelAlbumTracks();
    if (previous === "browse" && next !== "browse") {
      this.cancelTrackSearch();
    }
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
    this.cancelTrackSearch();
    this.cancelAlbumTracks();
    this.albumRequest?.controller.abort();
    if (this.albumRequest) this.albumRequest.pending = false;
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
        this.effects.reportError(errorMessage(error), () => this.search(query));
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
  cancelTrackSearch(): void {
    this.trackSearchVersion++;
    this.trackSearchAbort?.abort();
    this.store.state.requests.trackSearch = false;
    this.store.publish();
  }
  async searchTracks(query: string): Promise<void> {
    this.cancelTrackSearch();
    this.store.state.catalog.trackQuery = query;
    this.store.state.catalog.tracks = [];
    this.store.state.catalog.hasMoreTracks = !!query.trim();
    this.trackSearchPage = 0;
    this.store.publish();
    if (query.trim()) await this.loadMoreTracks();
  }
  async loadMoreTracks(): Promise<void> {
    const state = this.store.state;
    if (
      !this.navigation.isPageActive("browse") ||
      state.requests.trackSearch ||
      !state.catalog.hasMoreTracks ||
      !state.catalog.trackQuery.trim()
    )
      return;
    const version = this.trackSearchVersion;
    const controller = (this.trackSearchAbort = new AbortController());
    const page = this.trackSearchPage + 1;
    state.requests.trackSearch = true;
    this.store.publish();
    try {
      const result = await this.provider.searchTracks(state.catalog.trackQuery, page, {
        signal: controller.signal,
      });
      if (
        version !== this.trackSearchVersion ||
        controller.signal.aborted ||
        !this.navigation.isPageActive("browse")
      )
        return;
      const known = new Set(state.catalog.tracks.map((track) => track.id));
      const added = result.tracks.filter((track) => !known.has(track.id));
      if (result.hasMore && !added.length) throw new Error("歌曲搜索分页未前进，请重试");
      this.trackSearchPage = page;
      state.catalog.tracks = [...state.catalog.tracks, ...added];
      state.catalog.hasMoreTracks = result.hasMore;
      state.announcement = state.catalog.tracks.length
        ? `找到 ${state.catalog.tracks.length} 首歌曲`
        : "没有找到歌曲";
    } catch (error) {
      if (version === this.trackSearchVersion && !controller.signal.aborted)
        this.effects.reportError(errorMessage(error), () => this.loadMoreTracks());
    } finally {
      if (version === this.trackSearchVersion) {
        state.requests.trackSearch = false;
        this.store.publish();
      }
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
        this.effects.reportError(errorMessage(error), () => this.loadMoreAlbums());
    } finally {
      request.pending = false;
      if (request === this.albumRequest && !request.controller.signal.aborted) {
        this.store.state.requests.albums = false;
        this.store.publish();
      }
    }
  }
  private cancelAlbumTracks(): void {
    this.albumTrackRequest?.controller.abort();
    if (this.albumTrackRequest) this.albumTrackRequest.pending = false;
    this.store.state.requests.albumTracks = false;
  }
  async showAlbumTracks(album: Album): Promise<void> {
    this.cancelAlbumTracks();
    this.navigation.browse("albumTracks");
    this.store.state.catalog.album = album;
    this.store.state.catalog.albumTracks = [];
    this.store.state.catalog.hasMoreAlbumTracks = true;
    this.albumTrackRequest = {
      album,
      page: 0,
      pending: false,
      controller: new AbortController(),
    };
    await this.loadMoreAlbumTracks();
  }
  async loadMoreAlbumTracks(): Promise<void> {
    let request = this.albumTrackRequest;
    if (
      !request ||
      !this.navigation.isPageActive("albumTracks") ||
      request.pending ||
      !this.store.state.catalog.hasMoreAlbumTracks
    )
      return;
    if (request.controller.signal.aborted)
      request = this.albumTrackRequest = {
        ...request,
        pending: false,
        controller: new AbortController(),
      };
    request.pending = true;
    this.store.state.requests.albumTracks = true;
    this.store.publish();
    try {
      const result = await this.provider.getAlbumTrackPage(request.album.id, request.page + 1, {
        signal: request.controller.signal,
      });
      if (
        request !== this.albumTrackRequest ||
        request.controller.signal.aborted ||
        !this.navigation.isPageActive("albumTracks")
      )
        return;
      const known = new Set(this.store.state.catalog.albumTracks.map((track) => track.id));
      const added = result.tracks.filter((track) => {
        if (known.has(track.id)) return false;
        known.add(track.id);
        return true;
      });
      if (result.hasMore && !added.length) throw new Error("专辑歌曲分页未前进，请重试");
      request.page++;
      this.store.state.catalog.albumTracks = [...this.store.state.catalog.albumTracks, ...added];
      this.store.state.catalog.hasMoreAlbumTracks = result.hasMore;
    } catch (error) {
      if (request === this.albumTrackRequest && !request.controller.signal.aborted)
        this.effects.reportError(errorMessage(error), () => this.loadMoreAlbumTracks());
    } finally {
      request.pending = false;
      if (request === this.albumTrackRequest && !request.controller.signal.aborted) {
        this.store.state.requests.albumTracks = false;
        this.store.publish();
      }
    }
  }
  async showRadio(): Promise<void> {
    this.navigation.browse("browse");
    if (!this.store.state.catalog.tracks.length && this.store.state.catalog.hasMoreTracks)
      void this.loadMoreTracks();
    this.store.state.catalog.stations = [
      {
        id: "99",
        name: "私人电台",
        group: "根据你的听歌喜好推荐",
        coverUrl: "",
      },
      { id: "daily", name: "每日30首", group: "QQ 音乐每日专属推荐", coverUrl: "" },
    ];
    this.store.publish();
  }
  currentChanged(): void {
    this.lyricVersion++;
    this.lyricAbort?.abort();
    this.lyricId = null;
    this.store.state.lyrics = [];
    this.store.state.requests.lyrics = false;
    if (this.lyricsVisible()) void this.loadLyrics();
  }
  setInlineLyrics(visible: boolean): void {
    this.inlineLyrics = visible;
    if (visible) void this.loadLyrics();
  }
  private lyricsVisible(): boolean {
    const { navigation, auth } = this.store.state;
    return (
      navigation.view === "lyrics" ||
      (this.inlineLyrics && navigation.view === "player" && auth.state === "ready")
    );
  }
  showLyrics(): void {
    if (!this.store.state.playback.current) return;
    this.navigation.setView(this.store.state.navigation.view === "lyrics" ? "player" : "lyrics");
    if (this.store.state.navigation.view === "lyrics") void this.loadLyrics();
  }
  async loadLyrics(): Promise<void> {
    const track = this.store.state.playback.current;
    if (
      !track ||
      !this.lyricsVisible() ||
      this.lyricId === track.id ||
      this.store.state.requests.lyrics
    )
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
        this.effects.reportError(errorMessage(error), () => this.loadLyrics());
    } finally {
      if (version === this.lyricVersion) {
        this.store.state.requests.lyrics = false;
        this.store.publish();
      }
    }
  }
}
