import axios, { AxiosRequestConfig } from "axios";
import { zzcSign, encodeAG1Request, decodeAG1Response } from "@jixun/qmweb-sign";
import { logger } from "../../util/logger";
import { MusicCredential } from "./session";

export class AuthError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const hash33 = (value: string, seed = 5381) => {
  let hash = seed;
  for (const character of value) hash = (hash * 33 + character.charCodeAt(0)) | 0;
  return hash & 0x7fffffff;
};
export function musicCookie(credential: MusicCredential) {
  return `uin=${credential.musicid}; qqmusic_uin=${credential.musicid}; qqmusic_key=${credential.musickey}; qm_keyst=${credential.musickey}; login_type=${credential.loginType || 2}`;
}
export function musicComm(credential?: MusicCredential) {
  const token = hash33(credential?.musickey || "");
  return {
    ct: 24,
    cv: 4747474,
    format: "json",
    uin: String(credential?.musicid || 0),
    g_tk: token,
    g_tk_new_20200303: token,
    tmeLoginType: credential?.loginType || 2,
    ...(credential ? { authst: credential.musickey, tmeLoginType: credential.loginType || 2 } : {}),
  };
}
export function signPayload(payload: string) {
  return zzcSign(payload);
}
// This client deliberately logs no headers, bodies, redirects, or axios errors (all can contain credentials).
export async function authHttp(url: string, options: AxiosRequestConfig = {}) {
  try {
    return await axios({
      timeout: 12000,
      maxRedirects: 0,
      maxContentLength: 2 * 1024 * 1024,
      validateStatus: (status) => status >= 200 && status < 400,
      ...options,
      url,
      headers: {
        Referer: "https://y.qq.com/",
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
        ...options.headers,
      },
    });
  } catch (error) {
    const target = new URL(url);
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    const failureCode = axios.isAxiosError(error)
      ? error.code
      : (error as NodeJS.ErrnoException)?.code;
    const stage =
      target.pathname === "/check_sig"
        ? "QQ 登录票据验证"
        : target.pathname === "/oauth2.0/authorize"
          ? "QQ 音乐授权"
          : target.pathname.includes("music")
            ? "QQ 音乐会话交换"
            : "QQ 扫码服务";
    logger.warn(
      "auth.upstream.unavailable",
      JSON.stringify({ host: target.host, path: target.pathname, status, code: failureCode }),
    );
    throw new AuthError(
      502,
      "UPSTREAM_UNAVAILABLE",
      `${stage}失败（${status ? `HTTP ${status}` : failureCode || "NETWORK_ERROR"}），请重试`,
    );
  }
}
export function checkCodes(...codes: unknown[]) {
  for (const value of codes) {
    if (value === undefined || Number(value) === 0) continue;
    if ([301, 1000, 104400, 104401].includes(Number(value)))
      throw new AuthError(401, "AUTH_EXPIRED", "登录已过期，请重新登录");
    throw new AuthError(502, "UPSTREAM_REJECTED", `QQ 音乐请求未成功（${Number(value)}）`);
  }
}
export async function musicRequest(
  module: string,
  method: string,
  param: Record<string, unknown>,
  credential?: MusicCredential,
  signed = false,
) {
  const payload = JSON.stringify({ comm: musicComm(credential), req_0: { module, method, param } });
  const url = signed
    ? `https://u6.y.qq.com/cgi-bin/musics.fcg?encoding=ag-1&sign=${signPayload(payload)}&_=${Date.now()}`
    : "https://u.y.qq.com/cgi-bin/musicu.fcg";
  const response = await authHttp(url, {
    method: "POST",
    data: signed ? await encodeAG1Request(payload) : payload,
    ...(signed ? { responseType: "arraybuffer" as const } : {}),
    headers: {
      "Content-Type": signed ? "text/plain" : "application/json",
      ...(credential ? { Cookie: musicCookie(credential) } : {}),
    },
  });
  let body = response.data;
  if (signed) {
    const bytes = Buffer.from(body);
    try {
      body = JSON.parse(bytes.toString("utf8"));
    } catch {
      try {
        body = JSON.parse(decodeAG1Response(new Uint8Array(bytes)));
      } catch {
        throw new AuthError(502, "UPSTREAM_INVALID", "QQ 音乐返回数据无效");
      }
    }
  }
  if (!body || typeof body !== "object")
    throw new AuthError(502, "UPSTREAM_INVALID", "QQ 音乐返回数据无效");
  checkCodes(
    body.code,
    body.req_0?.code,
    body.req_0?.data?.code,
    body.req_0?.data?.subcode,
    body.req_0?.data?.retCode,
  );
  if (!body.req_0?.data || body.req_0.code === undefined || body.code === undefined)
    throw new AuthError(502, "UPSTREAM_INVALID", "QQ 音乐返回数据不完整");
  return body.req_0.data;
}
