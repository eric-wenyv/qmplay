import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { storeAuthCookies, authCookieHeader } = createRequire(import.meta.url)(
  "../electron/auth-cookies.cjs",
);
const now = Date.parse("2026-10-25T12:00:00Z");
function cookieStore() {
  const jar = new Map();
  let flushes = 0;
  return {
    jar,
    get flushes() {
      return flushes;
    },
    set: async (cookie) => {
      jar.set(cookie.name, cookie);
    },
    remove: async (_url, name) => {
      jar.delete(name);
    },
    flushStore: async () => {
      flushes++;
    },
  };
}
const headers = (line) => new Headers({ "Set-Cookie": line });
test("Expires keeps Koa QR and session cookies persistent, and a missing expiration creates a session cookie", async () => {
  const store = cookieStore();
  await storeAuthCookies(
    store,
    headers(
      "qq_music_challenge=owner; expires=Sun, 25 Oct 2026 12:05:00 GMT; httponly; samesite=strict",
    ),
    now,
  );
  assert.equal(store.jar.get("qq_music_challenge").expirationDate, now / 1000 + 300);
  await storeAuthCookies(store, headers("qq_music_session=token; HttpOnly"), now);
  assert.equal("expirationDate" in store.jar.get("qq_music_session"), false);
  assert.equal(store.jar.get("qq_music_session").httpOnly, true);
  assert.equal(store.jar.get("qq_music_session").sameSite, "strict");
  assert.equal(store.flushes, 2);
});
test("Max-Age overrides Expires, including zero and negative deletion values", async () => {
  const store = cookieStore();
  await storeAuthCookies(
    store,
    headers("qq_music_session=token; Max-Age=3600; Expires=Thu, 01 Jan 1970 00:00:00 GMT"),
    now,
  );
  assert.equal(store.jar.get("qq_music_session").expirationDate, now / 1000 + 3600);
  for (const age of ["0", "-1"]) {
    await storeAuthCookies(
      store,
      headers(`qq_music_session=token; Max-Age=${age}; Expires=Sun, 25 Oct 2026 12:05:00 GMT`),
      now,
    );
    assert.equal(store.jar.has("qq_music_session"), false);
  }
});
test("expired dates clear credentials while unrelated cookies and requests without Set-Cookie are ignored", async () => {
  const store = cookieStore();
  await storeAuthCookies(
    store,
    headers("qq_music_session=token; Expires=Thu, 01 Jan 1970 00:00:00 GMT"),
    now,
  );
  assert.equal(store.jar.size, 0);
  await storeAuthCookies(store, headers("uin=must-not-store; Max-Age=3600"), now);
  await storeAuthCookies(store, new Headers(), now);
  assert.equal(store.jar.size, 0);
  assert.equal(store.flushes, 1);
  assert.equal(
    authCookieHeader([
      { name: "qq_music_session", value: "opaque" },
      { name: "uin", value: "private" },
    ]),
    "qq_music_session=opaque",
  );
});
