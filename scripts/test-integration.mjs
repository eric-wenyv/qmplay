import assert from "node:assert/strict";
import { QQMusicProvider } from "../src/api.js";
import { ensureBackend } from "./backend.mjs";
const backend = await ensureBackend();
const provider = new QQMusicProvider({
  baseUrl: backend.connection.origin,
  fetcher: async (url, options = {}) => {
    const headers = new Headers(options.headers);
    headers.set("X-QMPLAY-Token", (await backend.start()).token);
    return fetch(url, { ...options, headers });
  },
});
try {
  await provider.checkConnection();
  const artists = await provider.searchArtists("周杰伦");
  assert(artists.some((artist) => artist.name === "周杰伦"));
  const singerTracks = await provider.getArtistTracks(artists[0].id);
  assert(singerTracks.length > 0);
  const albums = await provider.getArtistAlbums(artists[0].id);
  assert(albums.albums.length > 0);
  const albumSongs = await provider.getAlbumTrackPage(albums.albums[0].id);
  assert(albumSongs.tracks.length > 0);
  const singerNextPage = await provider.getArtistTrackPage(artists[0].id, 2);
  assert(singerNextPage.tracks.length > 0);
  assert(!singerTracks.some((track) => track.id === singerNextPage.tracks[0].id));
  const stations = await provider.getRadioStations();
  assert(stations.length > 0);
  const batch = await provider.getRadioTracks("199");
  assert(batch.length > 0);
  const songs = await provider.getRecommendedTracks();
  assert(songs.length > 0);
  const lines = await provider.getLyrics(songs[0].id);
  assert(Array.isArray(lines));
  console.log(
    `Live API: ${artists.length} artists, ${singerTracks.length} artist songs, ${albums.albums.length} albums, ${albumSongs.tracks.length} album songs, ${stations.length} stations, ${batch.length} radio songs, ${songs.length} recommendations, ${lines.length} lyric lines.`,
  );
  // Rights vary; try a bounded set of current recommendations and verify actual media bytes.
  let playable = false;
  for (const track of songs.slice(0, 5)) {
    try {
      const url = await provider.getPlayback(track);
      const response = await fetch(url, {
        headers: { Range: "bytes=0-1023" },
        signal: AbortSignal.timeout(12000),
      });
      const valid =
        response.ok && /audio|octet-stream/.test(response.headers.get("content-type") || "");
      await response.body?.cancel();
      if (valid) {
        playable = true;
        console.log(`Live audio verified: ${track.title} (HTTP ${response.status}).`);
        break;
      }
    } catch {
      /* Try another track when playback is restricted. */
    }
  }
  assert(
    playable,
    "No playable audio in the first five recommendations. Check network and upstream permissions.",
  );
} finally {
  backend.stop();
}
