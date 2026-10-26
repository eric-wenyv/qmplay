import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { buildFrontend } from "../scripts/build-frontend.mjs";

test("the shared renderer is a standalone CSP-compatible React bundle with its actual dependency licenses", async (t) => {
  const outdir = await mkdtemp(path.join(os.tmpdir(), "qmplay-renderer-"));
  t.after(() => rm(outdir, { recursive: true, force: true }));
  await mkdir(path.join(outdir, "src"));
  await writeFile(path.join(outdir, "src/api.js"), "obsolete copied renderer module");
  await buildFrontend({ outdir });
  const html = await readFile(path.join(outdir, "index.html"), "utf8");
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /script-src 'self'/);
  assert(!html.includes("'unsafe-eval'"));
  for (const reference of html.matchAll(/(?:src|href)="\.\/([^"?]+)"/g))
    assert(
      (await readFile(path.join(outdir, reference[1]))).length > 0,
      `Missing renderer asset: ${reference[1]}`,
    );
  assert.deepEqual((await readdir(path.join(outdir, "src"))).sort(), ["app.css", "app.js"]);
  const script = await readFile(path.join(outdir, "src/app.js"), "utf8");
  assert(
    !/from\s*["'](?:react|react-dom|node:)/.test(script),
    "Renderer must not depend on node_modules or Node APIs at runtime",
  );
  const dependencies = JSON.parse(
    await readFile(path.join(outdir, "assets/frontend/dependencies.json"), "utf8"),
  );
  for (const name of ["react", "react-dom", "scheduler"])
    assert(
      dependencies.some((dependency) => dependency.name === name),
      `Missing frontend license: ${name}`,
    );
  assert(
    !dependencies.some((dependency) => dependency.name === "koa"),
    "Backend code must not enter the renderer",
  );
  assert.match(
    await readFile(path.join(outdir, "assets/frontend/THIRD_PARTY_NOTICES.txt"), "utf8"),
    /Bundled frontend dependency notices/,
  );
});
