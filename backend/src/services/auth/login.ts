import { randomUUID } from "node:crypto";
import { authHttp, AuthError, hash33, musicRequest } from "./upstream";
import { MusicCredential, newToken } from "./session";

interface Challenge {
  qrsig: string;
  expiresAt: number;
  owner: string;
  busy: boolean;
  lastPoll: number;
  callback?: { url: string; cookies: Record<string, string> };
  graphCookies?: Record<string, string>;
}
const challenges = new Map<string, Challenge>();
export function responseCookies(
  headers: Record<string, any>,
  targetHost?: string,
): Record<string, string> {
  // A response can set graph.qq.com's p_skey and then delete qq.com's p_skey.
  // Those are different cookies. Apply deletions per domain before picking cookies for the next host.
  const scoped = new Map<string, { name: string; value: string; domain: string }>();
  const raw = headers["set-cookie"] || [];
  const lines: string[] = Array.isArray(raw) ? raw : String(raw).split(/,(?=\s*[^;,=\s]+=)/);
  for (const line of lines) {
    const [pair, ...attributes] = line.split(";"),
      index = pair.indexOf("=");
    if (index < 1) continue;
    const name = pair.slice(0, index).trim(),
      value = pair.slice(index + 1).trim();
    const domain = (
      attributes.find((attribute) => /^\s*domain=/i.test(attribute))?.split("=")[1] || ""
    )
      .trim()
      .replace(/^\./, "")
      .toLowerCase();
    if (targetHost && domain && targetHost !== domain && !targetHost.endsWith(`.${domain}`))
      continue;
    const key = `${domain}\0${name}`;
    if (!value || attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute)))
      scoped.delete(key);
    else scoped.set(key, { name, value, domain });
  }
  return Object.fromEntries(
    [...scoped.values()]
      .sort((a, b) => a.domain.length - b.domain.length)
      .map((cookie) => [cookie.name, cookie.value]),
  );
}
export function validCredential(data: any): MusicCredential {
  const musicid = Number(data?.musicid || data?.str_musicid);
  if (
    !Number.isSafeInteger(musicid) ||
    musicid <= 0 ||
    typeof data?.musickey !== "string" ||
    !/^[\w.-]+$/.test(data.musickey)
  )
    throw new AuthError(502, "LOGIN_INCOMPLETE", "未获得完整的 QQ 音乐授权，请重新登录");
  // Pick known fields; never persist arbitrary upstream data.
  return {
    musicid,
    musickey: data.musickey,
    loginType: Number(data.loginType) || 2,
    ...Object.fromEntries(
      [
        "openid",
        "refresh_token",
        "access_token",
        "refresh_key",
        "unionid",
        "str_musicid",
        "expired_at",
        "musickeyCreateTime",
        "keyExpiresIn",
      ]
        .filter((key) => typeof data[key] === "string" || typeof data[key] === "number")
        .map((key) => [key, data[key]]),
    ),
  };
}
export async function createLoginQr(owner: string) {
  for (const [id, challenge] of challenges)
    if (challenge.expiresAt <= Date.now() || challenge.owner === owner) challenges.delete(id);
  if (challenges.size >= 100) throw new AuthError(429, "LOGIN_BUSY", "登录请求过多，请稍后重试");
  const response = await authHttp("https://ssl.ptlogin2.qq.com/ptqrshow", {
    params: {
      appid: "716027609",
      e: 2,
      l: "M",
      s: 3,
      d: 72,
      v: 4,
      t: Math.random(),
      daid: 383,
      pt_3rd_aid: "100497308",
    },
    headers: { Referer: "https://xui.ptlogin2.qq.com/" },
    responseType: "arraybuffer",
  });
  const qrsig = responseCookies(response.headers).qrsig;
  const bytes = Buffer.from(response.data);
  if (!qrsig || !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
    throw new AuthError(502, "QR_INVALID", "无法获取登录二维码，请重试");
  const id = newToken(),
    expiresAt = Date.now() + 120000;
  challenges.set(id, { qrsig, expiresAt, owner, busy: false, lastPoll: 0 });
  return { id, image: `data:image/png;base64,${bytes.toString("base64")}`, expiresAt };
}
export async function checkLoginQr(
  id: string,
  owner: string,
): Promise<{ state: string; credential?: MusicCredential }> {
  const challenge = challenges.get(id);
  if (!challenge || challenge.owner !== owner || challenge.expiresAt <= Date.now())
    return { state: "expired" };
  if (challenge.busy || Date.now() - challenge.lastPoll < 1500)
    throw new AuthError(429, "POLL_TOO_FAST", "请稍后检查登录状态");
  challenge.busy = true;
  challenge.lastPoll = Date.now();
  try {
    if (!challenge.callback) {
      const response = await authHttp("https://ssl.ptlogin2.qq.com/ptqrlogin", {
        params: {
          u1: "https://graph.qq.com/oauth2.0/login_jump",
          ptqrtoken: hash33(challenge.qrsig, 0),
          ptredirect: 0,
          h: 1,
          t: 1,
          g: 1,
          from_ui: 1,
          ptlang: 2052,
          action: `0-0-${Date.now()}`,
          js_ver: "20102616",
          js_type: 1,
          pt_uistyle: 40,
          aid: "716027609",
          daid: 383,
          pt_3rd_aid: "100497308",
          has_onekey: 1,
        },
        headers: { Cookie: `qrsig=${challenge.qrsig}`, Referer: "https://xui.ptlogin2.qq.com/" },
        responseType: "text",
      });
      const args = [...String(response.data).matchAll(/'((?:\\.|[^'])*)'/g)].map(
        (match) => match[1],
      );
      const state = (
        { "66": "waiting", "67": "scanned", "65": "expired", "68": "cancelled" } as Record<
          string,
          string
        >
      )[args[0]];
      if (state) {
        if (["expired", "cancelled"].includes(state)) challenges.delete(id);
        return { state };
      }
      if (args[0] !== "0")
        throw new AuthError(502, "LOGIN_REJECTED", "QQ 登录未成功，请刷新二维码");
      const jump = new URL(args[2]);
      const uin = jump.searchParams.get("uin"),
        sigx = jump.searchParams.get("ptsigx");
      if (!uin || !/^\d+$/.test(uin) || !sigx)
        throw new AuthError(502, "LOGIN_INVALID", "QQ 登录授权数据无效");
      if (
        jump.origin !== "https://ssl.ptlogin2.graph.qq.com" ||
        jump.pathname !== "/check_sig" ||
        jump.username ||
        jump.password
      )
        throw new AuthError(502, "LOGIN_INVALID", "QQ 登录回调地址无效");
      challenge.callback = {
        url: jump.href,
        cookies: responseCookies(response.headers || {}, "ssl.ptlogin2.graph.qq.com"),
      };
    }
    let cookies = challenge.graphCookies;
    if (!cookies) {
      const loginCookies = challenge.callback.cookies;
      const checked = await authHttp(challenge.callback.url, {
        headers: {
          Referer: "https://xui.ptlogin2.qq.com/",
          Cookie: Object.entries(loginCookies)
            .map(([key, value]) => `${key}=${value}`)
            .join("; "),
        },
      });
      cookies = { ...loginCookies, ...responseCookies(checked.headers, "graph.qq.com") };
      if (cookies.p_skey) challenge.graphCookies = cookies;
    }
    if (!cookies.p_skey) throw new AuthError(502, "LOGIN_INCOMPLETE", "QQ 授权未完成，请重新扫码");
    const authorized = await authHttp("https://graph.qq.com/oauth2.0/authorize", {
      method: "POST",
      headers: {
        Cookie: Object.entries(cookies)
          .map(([key, value]) => `${key}=${value}`)
          .join("; "),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      data: new URLSearchParams({
        response_type: "code",
        client_id: "100497308",
        redirect_uri:
          "https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/",
        scope: "get_user_info,get_app_friends",
        state: id,
        switch: "",
        from_ptlogin: "1",
        src: "1",
        update_auth: "1",
        openapi: "1010_1030",
        g_tk: String(hash33(cookies.p_skey)),
        auth_time: String(Date.now()),
        ui: randomUUID(),
      }).toString(),
    });
    const location = new URL(authorized.headers.location || "https://y.qq.com/");
    const code = location.searchParams.get("code");
    if (location.origin !== "https://y.qq.com" || !code)
      throw new AuthError(502, "LOGIN_INCOMPLETE", "QQ 音乐授权未完成，请重新登录");
    const credential = validCredential(
      await musicRequest("QQConnectLogin.LoginServer", "QQLogin", { code }),
    );
    challenges.delete(id);
    return { state: "authenticated", credential };
  } finally {
    challenge.busy = false;
  }
}
export async function refreshCredential(credential: MusicCredential) {
  if (!credential.refresh_key || !credential.refresh_token)
    throw new AuthError(401, "AUTH_EXPIRED", "登录已过期，请重新登录");
  const {
    musicid,
    musickey,
    openid,
    refresh_token,
    refresh_key,
    unionid,
    str_musicid,
    access_token,
    expired_at,
  } = credential;
  return validCredential(
    await musicRequest(
      "music.login.LoginServer",
      "Login",
      {
        musicid,
        str_musicid: str_musicid || String(musicid),
        musickey,
        openid,
        refresh_token,
        refresh_key,
        unionid,
        access_token,
        expired_in: expired_at,
        loginMode: 2,
      },
      credential,
    ),
  );
}
