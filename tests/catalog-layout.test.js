import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FavoritesView } from "../src/ui/CatalogViews.js";

// jsdom has no layout engine; use an installed Chromium browser without adding a dependency.
const browser =
  process.env.QMPLAY_TEST_BROWSER ||
  process.env.CHROME_BIN ||
  ["google-chrome", "chromium", "chromium-browser"].find(
    (command) => spawnSync(command, ["--version"], { timeout: 5000 }).status === 0,
  );
const runBrowser = promisify(execFile);

test(
  "favorites keep long titles and artists within the list while allowing vertical scrolling",
  {
    skip: !browser && "Install Chrome/Chromium or set QMPLAY_TEST_BROWSER for layout checks",
    timeout: 40000,
  },
  async (t) => {
    t.diagnostic(`Layout browser: ${browser}`);
    const directory = await mkdtemp(path.join(os.tmpdir(), "qmplay-layout-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    const frames = [
      ["desktop", 540, 580],
      ["desktop", 360, 640],
      ["browser", 1024, 768],
      ["mobile", 360, 780],
      ["mobile", 320, 640],
    ].map(([mode, width, height]) => {
      const liked = Array.from({ length: 20 }, (_, index) => ({
        id: String(index),
        title: index % 2 ? "LongUnbrokenSongTitle".repeat(15) : "很长的中文歌曲名称".repeat(20),
        artist: "LongArtistName / 很长的歌手名称".repeat(20),
      }));
      const view = renderToStaticMarkup(
        createElement(FavoritesView, {
          app: {},
          snapshot: { navigation: { view: "liked" }, library: { liked } },
        }),
      );
      const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>
      <body class="${mode === "desktop" ? "desktop" : ""}">
        <main class="player"><header class="topbar"></header>
          <section class="main-stage">${view}</section><footer class="player-footer"></footer>
        </main>
      </body></html>`;
      return renderToStaticMarkup(
        createElement("iframe", {
          title: `${mode} ${width}x${height}`,
          width,
          height,
          srcDoc,
        }),
      );
    });
    const html = `<!doctype html><html><body>${frames.join("")}
    <pre id="layout-results"></pre><script>
      window.addEventListener("load", () => {
        const results = [...document.querySelectorAll("iframe")].map((frame) => {
          const doc = frame.contentDocument;
          const list = doc.querySelector("#liked-results");
          const row = list.querySelector(".artist-row");
          list.scrollTop = 100;
          return {
            name: frame.title,
            clientWidth: list.clientWidth, scrollWidth: list.scrollWidth,
            scrollTop: list.scrollTop,
            textFits: [...list.querySelectorAll(".artist-name, .artist-followers")].every(
              (text) => text.getBoundingClientRect().width <= text.parentElement.clientWidth + 1),
            playIconFits: row.lastElementChild.getBoundingClientRect().right <=
              list.getBoundingClientRect().right,
          };
        });
        document.querySelector("#layout-results").textContent = JSON.stringify(results);
      });
    </script></body></html>`;
    const fixture = path.join(directory, "favorites.html");
    await writeFile(fixture, html);
    const { stdout: output } = await runBrowser(
      browser,
      [
        "--headless",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-background-networking",
        "--no-first-run",
        "--no-default-browser-check",
        "--password-store=basic",
        "--disable-dev-shm-usage",
        `--user-data-dir=${path.join(directory, "profile")}`,
        "--timeout=10000",
        "--virtual-time-budget=1000",
        "--dump-dom",
        pathToFileURL(fixture).href,
      ],
      {
        encoding: "utf8",
        timeout: 30000,
        killSignal: "SIGKILL",
        maxBuffer: 5 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).catch((error) => {
      throw new Error(
        `Layout browser ${browser} failed (${error.code || error.signal}):\n${error.stderr || error.message}`,
        { cause: error },
      );
    });
    const result = output.match(/<pre id="layout-results">([^<]+)<\/pre>/);
    assert(result, "Browser did not report layout measurements");
    const measurements = JSON.parse(result[1]);
    assert.equal(measurements.length, frames.length);
    for (const item of measurements) {
      assert(item.clientWidth > 0, `${item.name}: list must be visible`);
      assert(
        item.scrollWidth <= item.clientWidth,
        `${item.name}: horizontal overflow ${JSON.stringify(item)}`,
      );
      assert(item.textFits, `${item.name}: long text must fit its column`);
      assert(item.playIconFits, `${item.name}: play icon must remain visible`);
      assert(item.scrollTop > 0, `${item.name}: vertical scrolling must remain available`);
    }
  },
);
