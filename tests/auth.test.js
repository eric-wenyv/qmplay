import test from "node:test";
import assert from "node:assert/strict";
import { Authentication } from "../src/auth.js";
function setup(provider) {
  const states = [],
    users = [],
    timers = [];
  const auth = new Authentication({
    provider,
    onState: (state) => states.push(state),
    onAuthenticated: async (user) => users.push(user),
    schedule: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    cancel() {},
  });
  return { auth, states, users, timers };
}
test("restored auth enters the app directly without requesting or displaying a QR", async () => {
  const { auth, states, users } = setup({
    getAuthStatus: async () => ({ authenticated: true, user: { uin: "12345" } }),
    createLoginQr: () => {
      throw Error("must not show login");
    },
  });
  await auth.start();
  assert.deepEqual(
    states.map((value) => value.state),
    ["checking", "ready"],
  );
  assert.deepEqual(users, [{ uin: "12345" }]);
});
test("missing auth displays QR, waits for phone confirmation and then enters the app", async () => {
  const replies = [{ state: "scanned" }, { state: "authenticated", user: { uin: "12345" } }];
  const { auth, states, users, timers } = setup({
    getAuthStatus: async () => ({ authenticated: false }),
    createLoginQr: async () => ({
      id: "qr",
      image: "data:image/png;base64,a",
      expiresAt: Date.now() + 60000,
    }),
    checkLoginQr: async () => replies.shift(),
  });
  await auth.start();
  await timers.shift()();
  await timers.shift()();
  assert.deepEqual(
    states.map((value) => value.state),
    ["checking", "loadingQr", "waiting", "scanned", "ready"],
  );
  assert.equal(users.length, 1);
  assert.equal(timers.length, 0);
});
test("network failures preserve the recovery screen and never request login", async () => {
  const { auth, states } = setup({
    getAuthStatus: async () => {
      throw Error("offline");
    },
    createLoginQr: () => {
      throw Error("not authorized");
    },
  });
  await auth.start();
  assert.equal(states.at(-1).state, "unavailable");
  assert.equal(states.at(-1).message, "offline");
});
test("expired/cancelled QR stops polling and retrying cannot consume an old in-flight result", async () => {
  let resolve;
  const provider = {
    getAuthStatus: () =>
      new Promise((done) => {
        resolve = done;
      }),
    createLoginQr: async () => ({ id: "qr", image: "image", expiresAt: Date.now() + 60000 }),
    checkLoginQr: async () => ({ state: "expired" }),
  };
  const { auth, states, users, timers } = setup(provider);
  const old = auth.start();
  await auth.login();
  resolve({ authenticated: true, user: { uin: "wrong-account" } });
  await old;
  assert.equal(users.length, 0);
  await timers.shift()();
  assert.equal(states.at(-1).state, "expired");
  assert.equal(timers.length, 0);
});
test("transient verification failures retry the same confirmed QR without making the user scan again", async () => {
  let polls = 0,
    qrRequests = 0;
  const { auth, states, users, timers } = setup({
    getAuthStatus: async () => ({ authenticated: false }),
    createLoginQr: async () => {
      qrRequests++;
      return { id: "original", image: "image", expiresAt: Date.now() + 60000 };
    },
    checkLoginQr: async (id) => {
      assert.equal(id, "original");
      if (++polls === 1)
        throw Object.assign(new Error("connection reset"), { code: "UPSTREAM_UNAVAILABLE" });
      return { state: "authenticated", user: { uin: "12345" } };
    },
  });
  await auth.start();
  await timers.shift()();
  assert.equal(states.at(-1).state, "waiting");
  assert.match(states.at(-1).message, /网络波动/);
  await timers.shift()();
  assert.equal(states.at(-1).state, "ready");
  assert.equal(qrRequests, 1);
  assert.equal(users.length, 1);
});
