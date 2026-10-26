import Router from "koa-router";
import getHotkey from "../controllers/getHotkey";
import getSmartbox from "../controllers/getSmartbox";
import getSingerList from "../controllers/getSingerList";
import getSingerHotsong from "../controllers/getSingerHotsong";
import getSingerStarNum from "../controllers/getSingerStarNum";
import getRadioLists from "../controllers/getRadioLists";
import getRadioTracks from "../controllers/getRadioTracks";
import getRecommend from "../controllers/getRecommend";
import getMusicPlay from "../controllers/getMusicPlay";
import getLyric from "../controllers/getLyric";
import getSongInfo from "../controllers/getSongInfo";
import { singerAlbums, albumTracks } from "../controllers/catalog";
import {
  authStatus,
  loginQr,
  loginQrCheck,
  logout,
  listFavorites,
  updateFavorite,
  accountMusicPlay,
} from "../controllers/auth";
import { SESSION_COOKIE } from "../services/auth/session";

export const API_PATHS = [
  "/getHotkey",
  "/getSmartbox",
  "/getSingerList",
  "/getSingerHotsong",
  "/getSingerStarNum",
  "/getRadioLists",
  "/getRadioTracks",
  "/getRecommend",
  "/getMusicPlay",
  "/getLyric",
  "/getSongInfo",
  "/auth/status",
  "/auth/qr",
  "/getSingerAlbum",
  "/getAlbumTracks",
  "/auth/qr/check",
  "/auth/logout",
  "/user/favorites",
] as const;

export function createRouter() {
  const router = new Router();
  router.get("/getHotkey", getHotkey);
  router.get("/getSmartbox", getSmartbox);
  router.get("/getSingerList", getSingerList);
  router.get("/getSingerHotsong", getSingerHotsong);
  router.get("/getSingerAlbum", singerAlbums);
  router.get("/getAlbumTracks", albumTracks);
  router.get("/getSingerStarNum", getSingerStarNum);
  router.get("/getRadioLists", getRadioLists);
  router.get("/getRadioTracks", getRadioTracks);
  router.get("/getRecommend", getRecommend);
  router.get("/getLyric", getLyric);
  router.get("/getSongInfo", getSongInfo);
  router.get("/getMusicPlay", async (ctx) => {
    if (ctx.cookies.get(SESSION_COOKIE, { signed: false })) await accountMusicPlay(ctx);
    else await getMusicPlay(ctx);
  });
  router.get("/auth/status", authStatus);
  router.post("/auth/qr", loginQr);
  router.post("/auth/qr/check", loginQrCheck);
  router.post("/auth/logout", logout);
  router.get("/user/favorites", listFavorites);
  router.post("/user/favorites", updateFavorite);
  return router;
}
