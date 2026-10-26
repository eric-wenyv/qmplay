import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { once } from "node:events";
import { fork } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";

test(
  "Android runtime protects its local UI and API, bootstraps cookies, and confines static files",
  { timeout: 15000 },
  async () => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const temporary = await mkdtemp(path.join(root, "tests/.android-test-"));
    const socket = createServer().listen(0, "127.0.0.1");
    await once(socket, "listening");
    const port = socket.address().port;
    await new Promise((resolve) => socket.close(resolve));
    const token = "a".repeat(64);
    const web = path.join(temporary, "web");
    let child;
    try {
      await mkdir(path.join(web, "src"), { recursive: true });
      await writeFile(path.join(web, "index.html"), "<title>Android player</title>");
      await writeFile(path.join(web, "src/test.js"), "export const mobile = true;");
      await writeFile(path.join(temporary, "private.txt"), "private");
      const entry = path.join(temporary, "server.cjs");
      await build({
        entryPoints: [path.join(root, "android/server.ts")],
        outfile: entry,
        bundle: true,
        platform: "node",
        format: "cjs",
        target: "node18",
        packages: "external",
        logLevel: "silent",
      });
      child = fork(entry, [web, String(port), token], {
        stdio: "ignore",
        env: {
          ...process.env,
          QQ_MUSIC_AUTH_DIR: path.join(temporary, "auth"),
          LOG_LEVEL: "silent",
        },
      });
      const origin = `http://127.0.0.1:${port}`;
      const request = (pathname, options = {}) =>
        fetch(origin + pathname, { ...options, signal: AbortSignal.timeout(2000) });
      let connected = false;
      for (let i = 0; i < 100; i++) {
        try {
          await request("/index.html");
          connected = true;
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
      }
      assert(connected, "Android server must start independently of Electron");
      assert.equal((await request("/api/auth/status")).status, 403);
      assert.equal((await request("/bootstrap?token=wrong", { redirect: "manual" })).status, 403);
      const boot = await request("/bootstrap?token=" + token, { redirect: "manual" });
      assert.equal(boot.status, 302);
      assert.match(boot.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
      const headers = { Cookie: `qmplay_local=${token}` };
      assert.match(await (await request("/index.html", { headers })).text(), /Android player/);
      const session = await request("/api/auth/status", { headers });
      assert.equal(session.status, 200);
      assert.equal((await session.json()).data.authenticated, false);
      assert.equal((await request("/api/health", { headers })).status, 200);
      assert.equal((await request("/private.txt", { headers })).status, 404);
      assert.equal((await request("/src/%2e%2e%2f%2e%2e%2fprivate.txt", { headers })).status, 404);
      assert.equal((await request("/src/test.js", { headers, method: "HEAD" })).status, 200);
      assert.equal(
        (
          await request("/api/user/favorites", {
            method: "POST",
            headers: {
              ...headers,
              Origin: "https://untrusted.test",
              "Content-Type": "application/json",
            },
            body: "{}",
          })
        ).status,
        403,
      );
    } finally {
      if (child && child.exitCode === null) {
        child.kill("SIGKILL");
        await once(child, "exit");
      }
      await rm(temporary, { recursive: true, force: true });
    }
  },
);
