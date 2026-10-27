import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

for (const shutdown of [
  "disconnect",
  ...(process.platform === "win32" ? [] : ["SIGTERM", "SIGINT"]),
])
  test(
    `browser development serves compiled React and the private API, then shuts down its watcher and backend (${shutdown})`,
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
        stdio: ["ignore", "pipe", "pipe", "ipc"],
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
        for (const pathname of [
          "/src/app.js",
          "/src/app.css",
          "/assets/frontend/dependencies.json",
        ])
          assert.equal((await request(pathname)).status, 200, pathname);
        assert.equal((await request("/src/main.tsx")).status, 404);
        assert.equal((await request("/package.json")).status, 404);
        assert.equal((await (await request("/api/auth/status")).json()).data.authenticated, false);
        if (shutdown === "disconnect") child.disconnect();
        else child.kill(shutdown);
        const result = await Promise.race([
          exit,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("Development shutdown timed out")), 3000);
          }),
        ]);
        assert.deepEqual(
          result,
          [0, null],
          "Development server should exit normally after cleanup",
        );
        await assert.rejects(request("/"));
      } finally {
        clearTimeout(timer);
        if (child.exitCode === null && child.signalCode === null) {
          if (child.connected) child.disconnect();
          timer = setTimeout(() => child.kill("SIGKILL"), 3000);
          try {
            await exit;
          } finally {
            clearTimeout(timer);
          }
        }
        await rm(auth, { recursive: true, force: true });
      }
    },
  );
