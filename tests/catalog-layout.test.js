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
import { RadioView } from "../src/ui/RadioView.js";
import { AlbumTracksView } from "../src/ui/AlbumTracksView.js";
import { QueuePanel } from "../src/ui/QueuePanel.js";

// jsdom has no layout engine; use an installed Chromium browser without adding a dependency.
const browser =
  process.env.QMPLAY_TEST_BROWSER ||
  process.env.CHROME_BIN ||
  ["google-chrome", "chromium", "chromium-browser"].find(
    (command) => spawnSync(command, ["--version"], { timeout: 5000 }).status === 0,
  );
const runBrowser = promisify(execFile);

test(
  "song lists and queues keep full-width actions, overlaid buttons and long scrollable rows within the page",
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
    ].flatMap(([mode, width, height]) =>
      ["favorites", "songs", "album", "queue"].map((feature) => {
        const liked = Array.from({ length: 20 }, (_, index) => ({
          id: String(index),
          title: index % 2 ? "LongUnbrokenSongTitle".repeat(15) : "很长的中文歌曲名称".repeat(20),
          artist: "LongArtistName / 很长的歌手名称".repeat(20),
        }));
        const view = renderToStaticMarkup(
          createElement(
            feature === "songs"
              ? RadioView
              : feature === "album"
                ? AlbumTracksView
                : feature === "queue"
                  ? QueuePanel
                  : FavoritesView,
            {
              app: {},
              snapshot: {
                navigation: {
                  view:
                    feature === "songs"
                      ? "browse"
                      : feature === "album"
                        ? "albumTracks"
                        : feature === "queue"
                          ? "queue"
                          : "liked",
                  mobile: mode === "mobile",
                  queueOpen: true,
                },
                playback: { queue: liked, index: 0, source: null },
                library: { liked },
                catalog: {
                  trackQuery: "测试歌曲",
                  tracks: liked,
                  hasMoreTracks: false,
                  album: { id: "album", name: "测试专辑" },
                  albumTracks: liked,
                  hasMoreAlbumTracks: false,
                },
                requests: { trackSearch: false, albumTracks: false },
              },
            },
          ),
        );
        const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><style>${css}
        * { animation: none !important; transition: none !important; }</style></head>
      <body class="${mode === "desktop" ? "desktop" : ""}">
        <main class="player"><header class="topbar"></header>
          <section class="main-stage">${view}</section><footer class="player-footer"></footer>
        </main>
      </body></html>`;
        return renderToStaticMarkup(
          createElement("iframe", {
            title: `${feature} ${mode} ${width}x${height}`,
            width,
            height,
            srcDoc,
          }),
        );
      }),
    );
    const html = `<!doctype html><html><body>${frames.join("")}
    <pre id="layout-results"></pre><script>
      window.addEventListener("load", () => {
        const results = [...document.querySelectorAll("iframe")].map((frame) => {
          const doc = frame.contentDocument;
          const list = doc.querySelector("#liked-results, #track-results, #album-track-results, #queue-list");
          const search = doc.querySelector("#track-search");
          const stage = doc.querySelector(".main-stage").getBoundingClientRect();
          const field = search?.getBoundingClientRect();
          const actionButton = list.querySelector("[data-next-track], [data-remove='1']");
          const action = actionButton?.getBoundingClientRect();
          const row = actionButton?.parentElement;
          const primary = row?.querySelector(".artist-row, .queue-row")?.getBoundingClientRect();
          const rowBounds = row?.getBoundingClientRect();
          actionButton?.focus({ preventScroll: true });
          const rowHighlight = row && getComputedStyle(row).backgroundColor;
          list.scrollTop = 100;
          return {
            name: frame.title,
            clientWidth: list.clientWidth, scrollWidth: list.scrollWidth,
            scrollTop: list.scrollTop,
            searchCentered: !field || Math.abs((field.left + field.right) / 2 - (stage.left + stage.right) / 2) <= 1,
            searchFirst: !search || search === search.parentElement.firstElementChild,
            textFits: [...list.querySelectorAll(".artist-name, .artist-followers, .queue-title, .queue-artist")].every(
              (text) => text.getBoundingClientRect().width <= text.parentElement.clientWidth + 1),
            nextButtonFits: !action || (action.left >= list.getBoundingClientRect().left &&
              action.right <= list.getBoundingClientRect().right && action.width >= 43.99 && action.height >= 43.99),
            fullRowAction: !!action && !!primary && !!rowBounds && Math.abs(primary.width - rowBounds.width) <= 1 &&
              action.right <= primary.right && getComputedStyle(actionButton).position === "absolute" &&
              getComputedStyle(row).position === "relative",
            fullRowHighlight: rowHighlight && rowHighlight !== "rgba(0, 0, 0, 0)" && rowHighlight !== "transparent",
            nextButtonBounds: action && { left: action.left, right: action.right, width: action.width, height: action.height },
            listBounds: { left: list.getBoundingClientRect().left, right: list.getBoundingClientRect().right },
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
      assert(item.searchCentered, `${item.name}: search field must be centered`);
      assert(item.searchFirst, `${item.name}: search field must be at the top`);
      assert(
        item.fullRowAction,
        `${item.name}: row button must overlay the full-width song action`,
      );
      assert(
        item.fullRowHighlight,
        `${item.name}: focusing row button must highlight the entire row`,
      );
      assert(
        item.nextButtonFits,
        `${item.name}: next button must remain visible and easy to tap ${JSON.stringify(item)}`,
      );
      assert(item.scrollTop > 0, `${item.name}: vertical scrolling must remain available`);
    }
  },
);
