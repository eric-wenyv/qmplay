import test, { after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { fork } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(path.join(root, "tests/.backend-test-"));
process.env.QQ_MUSIC_AUTH_DIR = path.join(temporary, "auth");
process.env.LOG_LEVEL = "silent";
const entry = path.join(temporary, "api.cjs");
await build({
  absWorkingDir: root,
  stdin: {
    contents: `export { createApp, API_PATHS } from './backend/src/app';
      export * as login from './backend/src/services/auth/login';
      export * as session from './backend/src/services/auth/session';
      export { default as axios } from 'axios';`,
    resolveDir: root,
    loader: "ts",
  },
  outfile: entry,
  bundle: true,
  packages: "external",
  platform: "node",
  format: "cjs",
  target: "node22",
});
const { createApp, session, axios } = createRequire(import.meta.url)(entry);
const originalAdapter = axios.defaults.adapter;
after(async () => {
  axios.defaults.adapter = originalAdapter;
  await rm(temporary, { recursive: true, force: true });
});

async function localApi(action, token = "local-test-token") {
  const server = createApp({ token }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (pathname, options = {}) =>
    fetch(`${origin}${pathname}`, {
      ...options,
      headers: { "X-QMPLAY-Token": token, ...options.headers },
    });
  try {
    await action(request, origin);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
function upstream(config, data, headers = {}) {
  return { config, data, headers, status: 200, statusText: "OK" };
}
function json(body, cookie) {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  };
}

test("song search validates pagination and always requests only songs", async () => {
  const calls = [];
  axios.defaults.adapter = async (config) => {
    calls.push(config);
    assert(config.url.endsWith("/soso/fcgi-bin/client_search_cp"));
    assert.equal(config.params.w, "晴天");
    assert.equal(config.params.t, 0);
    assert.equal(config.params.catZhida, 0);
    assert.equal(config.params.remoteplace, "txt.yqq.song");
    assert.equal(config.params.new_json, undefined);
    return upstream(config, { code: 0, data: { song: { list: [], totalnum: 0 } } });
  };
  await localApi(async (request, origin) => {
    assert.equal((await fetch(`${origin}/getSearchByKey?key=x`)).status, 403);
    for (const query of [
      "",
      "?key=",
      "?key=%20",
      "?key=x&page=0",
      "?key=x&limit=51",
      "?key=x&page=1.5",
      "?key=x&key=y",
    ])
      assert.equal((await request(`/getSearchByKey${query}`)).status, 400, query);
    assert.equal(calls.length, 0);
    const response = await request(
      `/getSearchByKey?${new URLSearchParams({ key: " 晴天 ", page: "2", limit: "20", t: "8", catZhida: "3" })}`,
    );
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).response.data.song.list, []);
    assert.equal(calls[0].params.p, 2);
    assert.equal(calls[0].params.n, 20);
  });
});

test("embedded API rejects unrelated interfaces and requires its process token before parsing requests", async () => {
  axios.defaults.adapter = async () => {
    throw new Error("Unexpected network request");
  };
  await localApi(async (request, origin) => {
    assert.equal((await fetch(`${origin}/health`)).status, 403);
    assert.equal((await fetch(`${origin}/auth/qr`, json({}))).status, 403);
    const health = await request("/health");
    assert.deepEqual(await health.json(), { service: "qmplay-api", version: 1 });
    for (const pathname of [
      "/explorer",
      "/explorer/metadata",
      "/getTopLists",
      "/getMv",
      "/user/setCookie",
      "/getRadioTracks/1",
    ])
      assert.equal((await request(pathname)).status, 404, pathname);
    assert.equal((await request("/getLyric", json({}))).status, 405);
    assert.equal((await request("/getRadioTracks?id=0")).status, 400);
    assert.equal((await request("/getSingerHotsong")).status, 400);
    assert.equal((await request("/getLyric")).status, 400);
    assert.equal((await request("/auth/status")).status, 200);
    for (const Origin of ["qmplay://app", "interlude://app"])
      assert.equal((await request("/auth/status", { headers: { Origin } })).status, 200);
    assert.equal((await request("/user/favorites")).status, 401);
    const invalid = await request("/auth/qr/check", json({ id: "invalid" }));
    assert.equal(invalid.status, 400);
    const foreign = await request("/auth/status", { headers: { Origin: "https://example.com" } });
    assert.equal(foreign.status, 403);
    assert.equal(foreign.headers.has("access-control-allow-origin"), false);
  });
});

test("current recommendation, radio, search and lyric contracts work without unused upstream queries", async () => {
  const calls = [];
  axios.defaults.adapter = async (config) => {
    calls.push(config);
    if (config.url.includes("musicu.fcg")) {
      const payload = JSON.parse(config.params.data);
      if (payload.new_song) {
        assert.deepEqual(Object.keys(payload).sort(), ["comm", "new_song"]);
        return upstream(config, {
          code: 0,
          new_song: { data: { songlist: [{ mid: "new-track" }] } },
        });
      }
      assert.deepEqual(payload.radio.param, { id: 199, firstplay: 0, num: 20 });
      return upstream(config, {
        code: 0,
        radio: { data: { track_list: [{ mid: "radio-track" }] } },
      });
    }
    if (config.url.includes("smartbox"))
      return upstream(config, { data: { singer: { itemlist: [{ mid: "artist" }] } } });
    if (config.url.includes("lyric"))
      return upstream(config, { code: 0, lyric: Buffer.from("[00:01.00]line").toString("base64") });
    throw new Error("Unexpected upstream");
  };
  await localApi(async (request) => {
    assert.equal(
      (await (await request("/getRecommend")).json()).response.new_song.data.songlist[0].mid,
      "new-track",
    );
    assert.equal(
      (await (await request("/getRadioTracks?id=199&firstplay=0")).json()).response.radio.data
        .track_list[0].mid,
      "radio-track",
    );
    assert.equal(
      (await (await request("/getSmartbox?key=artist")).json()).response.data.singer.itemlist[0]
        .mid,
      "artist",
    );
    assert.equal(
      (await (await request("/getLyric?songmid=song&isFormat=false")).json()).response.lyric,
      "[00:01.00]line",
    );
    assert.equal(calls.length, 4);
  });
});

test("personal radio requires the current account, refreshes credentials and keeps public radio compatible", async () => {
  const firstToken = session.newToken(),
    secondToken = session.newToken();
  const firstCredential = {
    musicid: 12345,
    musickey: "radio-old-key",
    refresh_token: "refresh",
    refresh_key: "refresh-key",
  };
  await session.sessions.save(firstToken, {
    credential: firstCredential,
    expiresAt: Date.now() + 60000,
  });
  await session.sessions.save(secondToken, {
    credential: { musicid: 67890, musickey: "radio-second-key" },
    expiresAt: Date.now() + 60000,
  });
  let batches = 0,
    refreshes = 0,
    invalid = false,
    outage = false;
  axios.defaults.adapter = async (config) => {
    assert.equal(config.method, "post");
    const payload = JSON.parse(config.data),
      request = payload.req_0;
    if (request.method === "Login") {
      refreshes++;
      return upstream(config, {
        code: 0,
        req_0: { code: 0, data: { ...firstCredential, musickey: "radio-new-key" } },
      });
    }
    assert.equal(request.module, "music.radioProxy.MbTrackRadioSvr");
    assert.equal(request.method, "get_radio_track");
    assert.deepEqual(request.param, { id: 99, num: 5, from: 0, scene: 0, song_ids: [] });
    if (payload.comm.authst === "radio-old-key") return upstream(config, { code: 301 });
    if (outage) throw Object.assign(new Error("network outage"), { code: "ETIMEDOUT" });
    const first = payload.comm.uin === "12345";
    assert.equal(payload.comm.authst, first ? "radio-new-key" : "radio-second-key");
    assert.match(config.headers.Cookie, new RegExp(`qqmusic_key=${payload.comm.authst}`));
    batches++;
    return upstream(config, {
      code: 0,
      req_0: {
        code: 0,
        data: invalid
          ? {}
          : {
              tracks: [{ mid: `${first ? "first" : "second"}-${batches}`, title: "猜你喜欢" }],
            },
      },
    });
  };
  try {
    await localApi(async (request) => {
      assert.equal((await request("/getRadioTracks?id=99")).status, 401);
      assert.equal(
        (await request("/getRadioTracks?id=99", { headers: { Origin: "https://example.com" } }))
          .status,
        403,
      );
      assert.equal(batches, 0);
      const headers = { Cookie: `qq_music_session=${firstToken}` };
      const first = await request("/getRadioTracks?id=99&firstplay=1", { headers });
      assert.equal(first.status, 200);
      assert.equal((await first.json()).response.radio.data.track_list[0].mid, "first-1");
      assert.equal(first.headers.get("cache-control"), "no-store");
      assert.equal(refreshes, 1);
      const next = await request("/getRadioTracks?id=99&firstplay=0", { headers });
      assert.equal((await next.json()).response.radio.data.track_list[0].mid, "first-2");
      const second = await request("/getRadioTracks?id=99", {
        headers: { Cookie: `qq_music_session=${secondToken}` },
      });
      assert.equal((await second.json()).response.radio.data.track_list[0].mid, "second-3");
      invalid = true;
      const malformed = await request("/getRadioTracks?id=99", { headers });
      assert.equal(malformed.status, 502);
      assert.equal((await malformed.json()).error.code, "UPSTREAM_INVALID");
      invalid = false;
      outage = true;
      assert.equal((await request("/getRadioTracks?id=99", { headers })).status, 502);
      assert(await session.sessions.get(firstToken));
    });
  } finally {
    await session.sessions.delete(firstToken);
    await session.sessions.delete(secondToken);
  }
});

test("daily recommendations require an account and read only its current daily playlist", async () => {
  const tokens = [session.newToken(), session.newToken()];
  for (const [index, token] of tokens.entries())
    await session.sessions.save(token, {
      credential: {
        musicid: index ? 67890 : 12345,
        musickey: index ? "daily-second-key" : "daily-old-key",
        refresh_token: "refresh",
        refresh_key: "refresh-key",
      },
      expiresAt: Date.now() + 60000,
    });
  let mode = "valid",
    refreshes = 0;
  const calls = [];
  axios.defaults.adapter = async (config) => {
    const payload = JSON.parse(config.data);
    const { module, method, param } = payload.req_0;
    if (method === "Login") {
      refreshes++;
      return upstream(config, {
        code: 0,
        req_0: { code: 0, data: { musicid: 12345, musickey: "daily-new-key" } },
      });
    }
    if (payload.comm.authst === "daily-old-key") return upstream(config, { code: 301 });
    const first = payload.comm.uin === "12345";
    assert.equal(payload.comm.authst, first ? "daily-new-key" : "daily-second-key");
    assert.match(config.headers.Cookie, new RegExp(`qqmusic_key=${payload.comm.authst}`));
    calls.push(method);
    let data;
    if (method === "get_recommend_feed") {
      assert.equal(module, "music.recommend.RecommendFeed");
      assert.deepEqual(param, { direction: 0, page: 1, v_cache: [], v_uniq: [], s_num: 0 });
      if (mode === "outage")
        throw Object.assign(new Error("network outage"), { code: "ETIMEDOUT" });
      const daily = {
        subtype: 510,
        id: first ? "98765" : "98766",
        time: Math.floor(Date.now() / 1000) - (mode === "stale" ? 86400 : 0),
      };
      if (mode === "invalid-id") daily.id = "not-a-playlist";
      const cards = [{ subtype: 511, id: "99999" }, daily];
      if (mode === "duplicate") cards.push({ ...daily });
      if (mode === "missing") cards.pop();
      data = { retcode: mode === "rejected" ? 9 : 0, v_shelf: [{ v_niche: [{ v_card: cards }] }] };
      if (mode === "malformed") data.v_shelf = [{}];
    } else {
      assert.equal(module, "music.srfDissInfo.DissInfo");
      assert.equal(method, "CgiGetDiss");
      assert.deepEqual(param, {
        disstid: first ? 98765 : 98766,
        dirid: 0,
        tag: true,
        song_begin: 0,
        song_num: 100,
        userinfo: true,
        orderlist: true,
        onlysonglist: false,
      });
      data = {
        songlist: Array.from({ length: 30 }, (_, index) => ({
          mid: `${first ? "first" : "second"}-${index}`,
        })),
        total_song_num: mode === "partial" ? 31 : 30,
        hasmore: 0,
      };
      if (mode === "invalid-tracks") delete data.songlist;
    }
    return upstream(config, { code: 0, req_0: { code: 0, data } });
  };
  try {
    await localApi(async (request) => {
      assert.equal((await request("/getDailyRecommend")).status, 401);
      const headers = { Cookie: `qq_music_session=${tokens[0]}` };
      assert.equal(
        (
          await request("/getDailyRecommend", {
            headers: { ...headers, Origin: "https://example.com" },
          })
        ).status,
        403,
      );
      assert.equal(calls.length, 0);
      for (const [index, token] of tokens.entries()) {
        const response = await request("/getDailyRecommend", {
          headers: { Cookie: `qq_music_session=${token}` },
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "no-store");
        const body = await response.json();
        assert.equal(body.data.tracks.length, 30);
        assert.equal(body.data.tracks[0].mid, index ? "second-0" : "first-0");
        assert.equal(JSON.stringify(body).includes("key"), false);
      }
      assert.equal(refreshes, 1);
      assert.deepEqual(calls, [
        "get_recommend_feed",
        "CgiGetDiss",
        "get_recommend_feed",
        "CgiGetDiss",
      ]);
      for (mode of [
        "stale",
        "invalid-id",
        "duplicate",
        "missing",
        "malformed",
        "rejected",
        "partial",
        "invalid-tracks",
        "outage",
      ]) {
        const response = await request("/getDailyRecommend", { headers });
        assert.equal(response.status, 502, mode);
        assert.equal((await response.json()).data, undefined, mode);
        assert(await session.sessions.get(tokens[0]), mode);
      }
    });
  } finally {
    for (const token of tokens) await session.sessions.delete(token);
  }
});

test("artist albums and album songs use offset pagination, and artist songs can pass the first thousand", async () => {
  const calls = [];
  axios.defaults.adapter = async (config) => {
    const payload = JSON.parse(config.params.data);
    calls.push(payload);
    if (payload.album)
      return upstream(config, {
        code: 0,
        album: { code: 0, data: { songList: [{ songInfo: { mid: "album-song" } }], totalNum: 51 } },
      });
    return upstream(config, {
      code: 0,
      singer: {
        code: 0,
        data:
          payload.singer.method === "GetAlbumList"
            ? { albumList: [{ albumMid: "album" }], total: 21 }
            : { songlist: [{ mid: "song1001" }], total_song: 1001 },
      },
    });
  };
  await localApi(async (request) => {
    assert.equal(
      (await (await request("/getSingerAlbum?singermid=singer&page=2&limit=20")).json()).response
        .singer.data.albumList[0].albumMid,
      "album",
    );
    assert.deepEqual(calls[0].singer.param, { singermid: "singer", sort: 5, begin: 20, num: 20 });
    assert.equal(
      (await (await request("/getAlbumTracks?albummid=album&page=2&limit=50")).json()).response
        .album.data.songList[0].songInfo.mid,
      "album-song",
    );
    assert.deepEqual(calls[1].album.param, { albumMid: "album", begin: 50, num: 50, order: 2 });
    assert.equal(
      (await (await request("/getSingerHotsong?singermid=singer&page=21&limit=50")).json()).response
        .singer.data.songlist[0].mid,
      "song1001",
    );
    assert.equal(calls[2].singer.param.sin, 1000);
    for (const pathname of [
      "/getSingerAlbum",
      "/getAlbumTracks",
      "/getSingerHotsong?singermid=singer&page=0",
      "/getAlbumTracks?albummid=album&limit=100000",
      "/getSingerAlbum?singermid=singer&page=1.5",
    ])
      assert.equal((await request(pathname)).status, 400, pathname);
    assert.equal(calls.length, 3);
  });
});

test("upstream transport errors never serialize Axios credentials or signed URLs", async () => {
  axios.defaults.adapter = async (config) => {
    throw Object.assign(new Error("secret-ticket at https://example.com/?signed=private"), {
      isAxiosError: true,
      code: "ERR_NETWORK",
      config: { ...config, headers: { Cookie: "private-cookie" } },
      toJSON() {
        return { message: this.message, config: this.config, code: this.code };
      },
    });
  };
  await localApi(async (request) => {
    const response = await request("/getHotkey");
    assert.equal(response.status, 500);
    const body = await response.text();
    assert.match(body, /UPSTREAM_UNAVAILABLE/);
    assert.doesNotMatch(body, /private|secret-ticket|config|Cookie|ERR_NETWORK/);
  });
});

test("encrypted account sessions survive reload, reject tampering and stay revoked during writes", async () => {
  const directory = path.join(temporary, "session-unit");
  const store = new session.SessionStore(directory);
  const token = session.newToken();
  const account = {
    credential: { musicid: 12345, musickey: "private-music-key" },
    expiresAt: Date.now() + 60000,
  };
  await store.save(token, account);
  const filename = path.join(
    directory,
    (await readdir(directory)).find((name) => name.endsWith(".session")),
  );
  const bytes = await readFile(filename);
  assert(!bytes.toString().includes("private-music-key"));
  // Windows uses the profile's ACL rather than POSIX permission bits.
  if (process.platform !== "win32") assert.equal((await stat(filename)).mode & 0o777, 0o600);
  assert.deepEqual(await new session.SessionStore(directory).get(token), account);
  assert.equal(await store.get("../../key"), null);
  bytes[30] ^= 255;
  await writeFile(filename, bytes);
  assert.equal(await store.get(token), null);
  await store.save(token, account);
  const writing = store.save(token, account).catch(() => {});
  await store.delete(token);
  await writing;
  assert.equal(await store.get(token), null);
  await assert.rejects(store.save(token, account), /revoked/);
});

test("QR confirmation preserves the original callback and stage cookies, stores only opaque client sessions", async () => {
  const calls = [];
  const callback =
    "https://ssl.ptlogin2.graph.qq.com/check_sig?uin=12345&ptsigx=private-signature&service=ptqrlogin&extra=preserved";
  let callbackAttempts = 0;
  axios.defaults.adapter = async (config) => {
    calls.push(config);
    if (config.url.includes("ptqrshow"))
      return upstream(config, Buffer.from("89504e470d0a1a0a", "hex"), {
        "set-cookie": ["qrsig=private-qr; HttpOnly"],
      });
    if (config.url.includes("/ptqrlogin"))
      return upstream(config, `ptuiCB('0','0','${callback}','0','成功','name');`, {
        "set-cookie": ["pt_token=private-stage-ticket; Path=/"],
      });
    if (config.url.includes("/check_sig")) {
      assert.equal(config.url, callback);
      assert.match(config.headers.Cookie, /pt_token=private-stage-ticket/);
      if (++callbackAttempts === 1)
        throw Object.assign(new Error("network"), { code: "ECONNRESET" });
      return upstream(config, "", {
        "set-cookie": [
          "p_skey=private-graph; Domain=graph.qq.com; Path=/",
          "p_skey=; Domain=qq.com; Max-Age=0",
        ],
      });
    }
    if (config.url.includes("/oauth2.0/authorize")) {
      assert.match(config.headers.Cookie, /p_skey=private-graph/);
      return upstream(config, "", {
        location: "https://y.qq.com/portal/wx_redirect.html?code=private-code",
      });
    }
    const payload = JSON.parse(config.data);
    if (payload.req_0.method === "QQLogin") {
      assert.deepEqual(payload.req_0.param, { code: "private-code" });
      return upstream(config, {
        code: 0,
        req_0: {
          code: 0,
          data: {
            musicid: 12345,
            musickey: "private-music-key",
            refresh_token: "refresh",
            refresh_key: "refresh-key",
          },
        },
      });
    }
    assert.equal(payload.req_0.param.dirid, 201);
    return upstream(config, {
      code: 0,
      req_0: { code: 0, data: { songlist: [], total_song_num: 0 } },
    });
  };
  await localApi(async (request) => {
    const qrResponse = await request("/auth/qr", json({}));
    const qr = (await qrResponse.json()).data;
    assert.equal(qrResponse.status, 200);
    assert.match(qr.image, /^data:image\/png;base64,/);
    const owner = qrResponse.headers.get("set-cookie").split(";")[0];
    assert.match(qrResponse.headers.get("set-cookie"), /httponly/i);
    const failed = await request("/auth/qr/check", json({ id: qr.id }, owner));
    assert.equal(failed.status, 502);
    await new Promise((resolve) => setTimeout(resolve, 1550));
    const confirmed = await request("/auth/qr/check", json({ id: qr.id }, owner));
    assert.equal(confirmed.status, 200);
    assert.deepEqual(await confirmed.json(), {
      data: { state: "authenticated", user: { uin: "12345" } },
    });
    const cookies = confirmed.headers.getSetCookie();
    const cookie = cookies.find((line) => line.startsWith("qq_music_session=")).split(";")[0];
    assert.match(cookie, /^qq_music_session=[a-f0-9]{64}$/);
    assert.equal(calls.filter((call) => call.url.includes("/ptqrlogin")).length, 1);
    const restored = await request("/auth/status", { headers: { Cookie: cookie } });
    assert.deepEqual(await restored.json(), {
      data: { authenticated: true, user: { uin: "12345" } },
    });
    const closed = await request("/auth/logout", json({}, cookie));
    assert.equal(closed.status, 200);
    assert.deepEqual(
      await (await request("/auth/status", { headers: { Cookie: cookie } })).json(),
      { data: { authenticated: false } },
    );
  });
});

test("mobile QQ authorization binds a single-use challenge to its owner and issues an opaque session", async () => {
  let exchangeStarted, releaseExchange;
  const started = new Promise((resolve) => {
    exchangeStarted = resolve;
  });
  const release = new Promise((resolve) => {
    releaseExchange = resolve;
  });
  let exchanges = 0;
  const qrUrl = `http://txz.qq.com/p?k=${"a".repeat(32)}&f=716027609`;
  let qr = qrUrl;
  axios.defaults.adapter = async (config) => {
    if (config.url.includes("/ptqrshow")) {
      assert.equal(config.params.type, 1);
      assert.equal(config.params.u1, "https://graph.qq.com/oauth2.0/login_jump");
      return upstream(config, `ptui_qrcode_CB(${JSON.stringify({ ec: 0, qrcode: qr })});`, {
        "set-cookie": ["qrsig=private-mobile-qr; HttpOnly"],
      });
    }
    if (config.url.includes("/ptqrlogin")) {
      assert.equal(config.headers.Cookie, "qrsig=private-mobile-qr");
      const callback =
        "https://ssl.ptlogin2.graph.qq.com/check_sig?uin=22222&ptsigx=private-signature";
      return upstream(config, `ptuiCB('0','0','${callback}','0','成功','name');`);
    }
    if (config.url.includes("/check_sig"))
      return upstream(config, "", { "set-cookie": ["p_skey=private-graph; Domain=graph.qq.com"] });
    if (config.url.includes("/oauth2.0/authorize"))
      return upstream(config, "", {
        location: "https://y.qq.com/portal/wx_redirect.html?code=private-auth-code",
      });
    const { req_0: request } = JSON.parse(config.data);
    if (request.method === "QQLogin") {
      assert.equal(request.module, "QQConnectLogin.LoginServer");
      assert.deepEqual(request.param, { code: "private-auth-code" });
      exchanges++;
      exchangeStarted();
      await release;
      return upstream(config, {
        code: 0,
        req_0: { code: 0, data: { musicid: 22222, musickey: "private-music-key" } },
      });
    }
    assert.equal(request.param.dirid, 201);
    return upstream(config, {
      code: 0,
      req_0: { code: 0, data: { songlist: [], total_song_num: 0 } },
    });
  };
  await localApi(async (request) => {
    qr = qrUrl.replace("txz.qq.com", "txz.qq.com.untrusted.test");
    const unsafe = await request("/auth/qq", json({}));
    assert.equal(unsafe.status, 502);
    assert.doesNotMatch(await unsafe.text(), /untrusted|private-mobile-qr/);
    qr = qrUrl;
    const opening = await request("/auth/qq", json({}));
    assert.equal(opening.status, 200);
    const header = opening.headers.get("set-cookie");
    assert.match(header, /; httponly/i);
    assert.match(header, /; samesite=strict/i);
    const owner = header.split(";")[0];
    const { id, url, expiresAt, image } = (await opening.json()).data;
    assert.equal(url, qrUrl.replace("http:", "https:"));
    assert.equal(image, undefined);
    assert(expiresAt > Date.now());
    const endpoint = "/auth/qr/check";
    const callback = { id };
    const foreign = await request(endpoint, json(callback));
    assert.deepEqual(await foreign.json(), { data: { state: "expired" } });
    assert.equal(exchanges, 0);
    const completion = request(endpoint, json(callback, owner));
    try {
      await started;
      assert.equal((await request(endpoint, json(callback, owner))).status, 429);
    } finally {
      releaseExchange();
    }
    const confirmed = await completion;
    assert.equal(confirmed.status, 200);
    assert.deepEqual(await confirmed.json(), {
      data: { state: "authenticated", user: { uin: "22222" } },
    });
    const cookie = confirmed.headers
      .getSetCookie()
      .find((line) => line.startsWith("qq_music_session="));
    assert.match(cookie, /^qq_music_session=[a-f0-9]{64};/);
    assert.match(cookie, /; httponly/i);
    assert.match(cookie, /; samesite=strict/i);
    const restored = await request("/auth/status", { headers: { Cookie: cookie.split(";")[0] } });
    assert.deepEqual(await restored.json(), {
      data: { authenticated: true, user: { uin: "22222" } },
    });
    const replay = await request(endpoint, json(callback, owner));
    assert.deepEqual(await replay.json(), { data: { state: "expired" } });
    assert.equal(exchanges, 1);
  });
});

test("account refresh and playback retain isolated credentials, while a network outage preserves the session", async () => {
  const firstToken = session.newToken(),
    secondToken = session.newToken();
  const firstCredential = {
    musicid: 12345,
    musickey: "first-old-key",
    refresh_token: "refresh",
    refresh_key: "refresh-key",
  };
  await session.sessions.save(firstToken, {
    credential: firstCredential,
    expiresAt: Date.now() + 60000,
  });
  await session.sessions.save(secondToken, {
    credential: { musicid: 67890, musickey: "second-key" },
    expiresAt: Date.now() + 60000,
  });
  let refreshes = 0,
    outage = false;
  axios.defaults.adapter = async (config) => {
    if (outage) throw Object.assign(new Error("temporary outage"), { code: "ETIMEDOUT" });
    const payload = JSON.parse(config.data),
      request = payload.req_0;
    if (request.method === "Login") {
      refreshes++;
      assert.equal(request.param.refresh_token, "refresh");
      assert.equal(request.param.loginMode, 2);
      return upstream(config, {
        code: 0,
        req_0: { code: 0, data: { ...firstCredential, musickey: "first-new-key" } },
      });
    }
    if (payload.comm.authst === "first-old-key") return upstream(config, { code: 301 });
    const first = payload.comm.uin === "12345";
    assert.equal(payload.comm.authst, first ? "first-new-key" : "second-key");
    assert.match(
      config.headers.Cookie,
      new RegExp(`qqmusic_key=${first ? "first-new-key" : "second-key"}`),
    );
    if (request.method === "CgiGetVkey") {
      assert.deepEqual(request.param.filename, ["F000media-id.flac"]);
      return upstream(config, {
        code: 0,
        req_0: {
          code: 0,
          data: {
            sip: ["https://audio.qq.com/"],
            midurlinfo: [{ songmid: "song-mid", purl: "allowed.flac" }],
          },
        },
      });
    }
    return upstream(config, {
      code: 0,
      req_0: {
        code: 0,
        data: {
          songlist: [{ mid: first ? "first-account-song" : "second-account-song" }],
          total_song_num: 1,
        },
      },
    });
  };
  await localApi(async (request) => {
    const firstCookie = { Cookie: `qq_music_session=${firstToken}` };
    const secondCookie = { Cookie: `qq_music_session=${secondToken}` };
    const first = await request("/user/favorites", { headers: firstCookie });
    assert.equal((await first.json()).data.songs[0].mid, "first-account-song");
    assert.equal(refreshes, 1);
    const second = await request("/user/favorites", { headers: secondCookie });
    assert.equal((await second.json()).data.songs[0].mid, "second-account-song");
    const playback = await request("/getMusicPlay?songmid=song-mid&mediaId=media-id&quality=flac", {
      headers: firstCookie,
    });
    assert.deepEqual((await playback.json()).data, {
      playUrl: {
        "song-mid": { url: "https://audio.qq.com/allowed.flac", error: false },
      },
    });
    outage = true;
    assert.equal((await request("/auth/status", { headers: firstCookie })).status, 502);
    assert(await session.sessions.get(firstToken), "A transient outage must not revoke a session");
    outage = false;
    const restored = await request("/auth/status", { headers: firstCookie });
    assert.deepEqual(await restored.json(), {
      data: { authenticated: true, user: { uin: "12345" } },
    });
  });
  await session.sessions.delete(firstToken);
  await session.sessions.delete(secondToken);
});

test("expired QQ music keys are renewed before playback or sent back to login", async () => {
  const expired = {
    musicid: 12345,
    musickey: "expired-key",
    musickeyCreateTime: Math.floor(Date.now() / 1000) - 259201,
    keyExpiresIn: 259200,
  };
  const mid = "0039MnYb0qxYhV";
  const playbackPath = `/getMusicPlay?songmid=${mid}&mediaId=003Qui1q2u1Zho&quality=128`;
  const tokens = await Promise.all(
    [
      expired,
      expired,
      { ...expired, refresh_token: "refresh-token", refresh_key: "refresh-key" },
    ].map(async (credential) => {
      const token = session.newToken();
      await session.sessions.save(token, { credential, expiresAt: Date.now() + 60000 });
      return token;
    }),
  );
  let refreshes = 0;
  let outage = true;
  let playable = true;
  axios.defaults.adapter = async (config) => {
    const { comm, req_0: request } = JSON.parse(config.data);
    if (request.method === "Login") {
      refreshes++;
      if (outage) throw Object.assign(new Error("temporary outage"), { code: "ETIMEDOUT" });
      return upstream(config, {
        code: 0,
        req_0: {
          code: 0,
          data: {
            ...expired,
            musickey: "renewed-key",
            musickeyCreateTime: Math.floor(Date.now() / 1000),
          },
        },
      });
    }
    assert.equal(comm.authst, "renewed-key", "Do not send the expired key to account APIs");
    if (request.method === "CgiGetVkey") {
      assert.deepEqual(request.param.songmid, [mid]);
      assert.deepEqual(request.param.filename, ["M500003Qui1q2u1Zho.mp3"]);
      return upstream(config, {
        code: 0,
        req_0: {
          code: 0,
          data: {
            sip: ["https://audio.qq.com/"],
            midurlinfo: [
              { songmid: mid, result: playable ? 0 : 104003, purl: playable ? "sunny.mp3" : "" },
            ],
          },
        },
      });
    }
    return upstream(config, { code: 0, req_0: { code: 0, data: { songlist: [] } } });
  };
  await localApi(async (request) => {
    const get = (url, token) => request(url, { headers: { Cookie: `qq_music_session=${token}` } });
    for (const [url, token] of [
      ["/auth/status", tokens[0]],
      [playbackPath, tokens[1]],
    ]) {
      const response = await get(url, token);
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error.code, "AUTH_EXPIRED");
      assert.match(response.headers.get("set-cookie"), /^qq_music_session=;/);
      assert.equal(await session.sessions.get(token), null);
    }
    assert.equal(refreshes, 0);
    const renewable = tokens[2];
    assert.equal((await get(playbackPath, renewable)).status, 502);
    assert(await session.sessions.get(renewable));
    outage = false;
    const [status, playback] = await Promise.all([
      get("/auth/status", renewable),
      get(playbackPath, renewable),
    ]);
    assert.equal((await status.json()).data.authenticated, true);
    assert.equal((await playback.json()).data.playUrl[mid].url, "https://audio.qq.com/sunny.mp3");
    assert.equal(refreshes, 2, "one failed refresh and one successful shared refresh");
    playable = false;
    assert.equal((await (await get(playbackPath, renewable)).json()).data.playUrl[mid].url, "");
    assert(
      await session.sessions.get(renewable),
      "A track restriction must not revoke the session",
    );
  });
  await session.sessions.delete(tokens[2]);
});

test("standalone embedded process announces its ephemeral loopback address and shuts down with its owner", async () => {
  const serverFile = path.join(temporary, "server.cjs");
  await build({
    entryPoints: [path.join(root, "backend/src/server.ts")],
    outfile: serverFile,
    bundle: true,
    packages: "external",
    platform: "node",
    format: "cjs",
    target: "node22",
  });
  const child = fork(serverFile, [], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    env: { ...process.env, PORT: "0", QMPLAY_API_TOKEN: "process-test-token" },
  });
  try {
    const result = await Promise.race([
      once(child, "message").then(([message]) => message),
      once(child, "exit").then(([code]) => {
        throw new Error(`Backend exited before ready: ${code}`);
      }),
      new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error("Backend startup timeout")), 10000);
        timer.unref();
      }),
    ]);
    assert.equal(result.type, "ready");
    assert.match(result.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    const health = await fetch(`${result.origin}/health`, {
      headers: { "X-QMPLAY-Token": "process-test-token" },
    });
    assert.equal(health.status, 200);
    const stopped = once(child, "exit");
    child.disconnect();
    assert.equal((await stopped)[0], 0);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
});
