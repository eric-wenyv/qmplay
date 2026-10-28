import y_common from "../y_common";

/** Request only songs; omit new_json, which makes this upstream return empty results. */
export async function getSearchByKey(key: string, page: number, limit: number) {
  const result = await y_common({
    url: "/soso/fcgi-bin/client_search_cp",
    options: {
      params: {
        w: key,
        p: page,
        n: limit,
        t: 0,
        catZhida: 0,
        format: "json",
        outCharset: "utf-8",
        ct: 24,
        qqmusic_ver: 1298,
        remoteplace: "txt.yqq.song",
        aggr: 1,
        cr: 1,
        lossless: 0,
        flag_qc: 0,
        platform: "yqq.json",
      },
    },
  });
  return result.data;
}
