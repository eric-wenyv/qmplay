const { API_ORIGIN } = require("./api.cjs");
const AUTH_COOKIE_NAMES = new Set(["qq_music_session", "qq_music_challenge"]);

function authCookieHeader(cookies) {
  return cookies
    .filter((cookie) => AUTH_COOKIE_NAMES.has(cookie.name))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

async function storeAuthCookies(store, headers, now = Date.now()) {
  let changed = false;
  for (const header of headers.getSetCookie()) {
    const [pair, ...attributes] = header.split(";");
    const index = pair.indexOf("=");
    if (index < 1) continue;
    const name = pair.slice(0, index).trim(),
      value = pair.slice(index + 1);
    if (!AUTH_COOKIE_NAMES.has(name)) continue;
    const options = new Map(
      attributes.map((attribute) => {
        const index = attribute.indexOf("=");
        return index < 0
          ? [attribute.trim().toLowerCase(), ""]
          : [attribute.slice(0, index).trim().toLowerCase(), attribute.slice(index + 1).trim()];
      }),
    );
    const maxAge = options.get("max-age");
    const seconds = maxAge !== undefined && /^[+-]?\d+$/.test(maxAge) ? Number(maxAge) : NaN;
    const expires = Date.parse(options.get("expires") || "");
    // Koa's cookies package sends Expires for maxAge. Max-Age, when present, takes precedence.
    const expirationDate = Number.isFinite(seconds)
      ? now / 1000 + seconds
      : Number.isFinite(expires)
        ? expires / 1000
        : undefined;
    if (!value || (expirationDate !== undefined && expirationDate <= now / 1000)) {
      await store.remove(API_ORIGIN, name);
    } else {
      await store.set({
        url: API_ORIGIN,
        name,
        value,
        httpOnly: true,
        path: "/",
        sameSite: "strict",
        ...(expirationDate !== undefined ? { expirationDate } : {}),
      });
    }
    changed = true;
  }
  if (changed) await store.flushStore();
}

module.exports = { authCookieHeader, storeAuthCookies };
