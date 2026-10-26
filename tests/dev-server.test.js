import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

test(
  "browser development serves compiled React and the private API, then shuts down its watcher and backend",
  { timeout: 20000 },
  async () => {
    const probe = createServer().listen(0, "127.0.0.1");
    await once(probe, "listening");
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    const auth = await mkdtemp(path.join(os.tmpdir(), "qmplay-dev-auth-"));
    const child = spawn(process.execPath, ["scripts/dev.mjs"], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: { ...process.env, PORT: String(port), QQ_MUSIC_AUTH_DIR: auth, LOG_LEVEL: "silent" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr.resume();
    const exit = once(child, "exit");
    let timer;
    try {
      await Promise.race([
        new Promise((resolve) =>
          child.stdout.on("data", (data) => {
            if (String(data).includes(`http://127.0.0.1:${port}`)) resolve();
          }),
        ),
        exit.then(([code]) => {
          throw new Error(`Development server exited before readiness (${code})`);
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Development startup timed out")), 15000);
        }),
      ]);
      clearTimeout(timer);
      const request = (pathname) =>
        fetch(`http://127.0.0.1:${port}${pathname}`, { signal: AbortSignal.timeout(3000) });
      const html = await (await request("/")).text();
      assert.match(html, /<div id="root"><\/div>/);
      for (const pathname of ["/src/app.js", "/src/app.css", "/assets/frontend/dependencies.json"])
        assert.equal((await request(pathname)).status, 200, pathname);
      assert.equal((await request("/src/main.tsx")).status, 404);
      assert.equal((await request("/package.json")).status, 404);
      assert.equal((await (await request("/api/auth/status")).json()).data.authenticated, false);
      child.kill("SIGTERM");
      const [code] = await Promise.race([
        exit,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Development shutdown timed out")), 3000);
        }),
      ]);
      assert.equal(code, 0);
      await assert.rejects(request("/"));
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await exit;
      }
      await rm(auth, { recursive: true, force: true });
    }
  },
);
