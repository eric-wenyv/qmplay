import services from "../index";

export async function getSingerAlbums(singermid: string, page: number, limit: number) {
  const result = await services.UCommon({
    params: {
      format: "json",
      data: JSON.stringify({
        comm: { ct: 24, cv: 0 },
        singer: {
          module: "music.musichallAlbum.AlbumListServer",
          method: "GetAlbumList",
          param: { singermid, sort: 5, begin: (page - 1) * limit, num: limit },
        },
      }),
    },
  });
  return result.data;
}

export async function getAlbumTracks(albummid: string, page: number, limit: number) {
  const result = await services.UCommon({
    params: {
      format: "json",
      data: JSON.stringify({
        comm: { ct: 24, cv: 0 },
        album: {
          module: "music.musichallAlbum.AlbumSongList",
          method: "GetAlbumSongList",
          param: { albumMid: albummid, begin: (page - 1) * limit, num: limit, order: 2 },
        },
      }),
    },
  });
  return result.data;
}
