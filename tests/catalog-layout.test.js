import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { FavoritesView } from "../src/ui/CatalogViews.js";
import { RadioView } from "../src/ui/RadioView.js";
import { AlbumTracksView } from "../src/ui/AlbumTracksView.js";
import { PlaybackControls, PlayerView } from "../src/ui/PlayerView.js";
import { QueuePanel } from "../src/ui/QueuePanel.js";

// jsdom has no layout engine; use an installed Chromium browser without adding a dependency.
const browser =
  process.env.QMPLAY_TEST_BROWSER ||
  process.env.CHROME_BIN ||
  ["google-chrome", "chromium", "chromium-browser"].find(
    (command) => spawnSync(command, ["--version"], { timeout: 5000 }).status === 0,
  );
const runBrowser = promisify(execFile);
let navigationScript;

async function bundledNavigation() {
  if (navigationScript) return navigationScript;
  const { outputFiles } = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL("../", import.meta.url)),
      contents: `import { createElement } from "react";
        import { createRoot } from "react-dom/client";
        import { flushSync } from "react-dom";
        import { Navigation } from "./src/ui/Navigation.tsx";
        window.installNavigation = (mobile) => {
          const root = createRoot(document.querySelector("#navigation-root"));
          if (!mobile) window.qmplayDesktop = { minimize() {}, close() {} };
          let snapshot = { auth: { state: "ready" }, requests: { auth: false }, navigation: {
            view: "player", mobileMode: "radio", mobile, menuOpen: false } };
          const update = (patch) => {
            snapshot = { ...snapshot, navigation: { ...snapshot.navigation, ...patch } };
            flushSync(() => root.render(createElement(Navigation, { app, snapshot })));
          };
          const choose = (view, mode) => update({ view, mobileMode: mode, menuOpen: false });
          const app = {
            setMenu: (menuOpen) => update({ menuOpen }),
            returnToPlayer: () => choose("player", "radio"),
            showSearch: () => choose("search", "artist"),
            showRadio: () => choose("browse", "radio"),
            showLiked: () => choose("liked", "liked"),
            openQueue: () => choose("queue", "queue"),
          };
          update({});
          return { app, getSnapshot: () => snapshot,
            dispatch: (event) => flushSync(() => document.querySelector("#mode-toggle").dispatchEvent(event)),
            unmount: () => flushSync(() => root.unmount()) };
        };`,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  navigationScript = outputFiles[0].text;
  return navigationScript;
}

async function measureLayout(directory, html, extraArgs = []) {
  const fixture = path.join(directory, "layout.html");
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
      ...extraArgs,
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
  return JSON.parse(result[1]);
}

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
                        : feature === "queue" && mode === "mobile"
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
    const measurements = await measureLayout(directory, html);
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

test(
  "mobile player keeps its controls spaced and covers separate before swapping layers",
  { skip: !browser && "Install Chrome/Chromium for cover flow motion checks", timeout: 40000 },
  async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "qmplay-cover-flow-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    const queue = Array.from({ length: 5 }, (_, index) => ({
      id: String(index),
      title: "很长的中文歌曲名称".repeat(3),
      duration: 180,
    }));
    const snapshot = {
      navigation: { mobile: true, view: "player" },
      playback: { queue, current: queue[1], index: 1, elapsed: 0 },
      library: { liked: [], busyIds: [] },
      requests: {},
    };
    const view = renderToStaticMarkup(
      createElement(PlayerView, {
        app: {},
        inert: false,
        selectedIndex: 2,
        snapshot,
      }),
    );
    const footer = renderToStaticMarkup(
      createElement(PlaybackControls, { app: {}, snapshot, inert: false, previewIndex: 2 }),
    );
    const frames = [
      [320, 640],
      [360, 752],
      [430, 820],
      [560, 980],
      [560, 1080],
    ].map(([width, height]) =>
      renderToStaticMarkup(
        createElement("iframe", {
          width,
          height,
          srcDoc: `<!doctype html><meta charset="utf-8"><style>${css}</style>
          <main class="player"><header class="topbar"></header>
          <section class="main-stage">${view}</section>${footer}</main>`,
        }),
      ),
    );
    const results = await measureLayout(
      directory,
      `<!doctype html><meta charset="utf-8">
      ${frames.join("")}<pre id="layout-results"></pre><script>
      addEventListener("load", () => {
        const results = [...document.querySelectorAll("iframe")].map((frame) => {
          const doc = frame.contentDocument;
          const win = frame.contentWindow;
          doc.body.getBoundingClientRect();
          doc.getAnimations().forEach((animation) => animation.finish());
          const flow = doc.querySelector(".cover-flow");
          const card = (offset) => flow.querySelector('[data-offset="' + offset + '"]');
          const art = (offset) => card(offset).querySelector(".album-art");
          const angle = (node) => {
            const matrix = new DOMMatrixReadOnly(win.getComputedStyle(node).transform);
            return Math.atan2(matrix.m13, matrix.m11);
          };
          const center = (node) => {
            const bounds = node.getBoundingClientRect();
            return (bounds.left + bounds.right) / 2;
          };
          const current = art(0), previous = art(-1), next = art(1);
          const stationary = [angle(previous), angle(current), angle(next)];
          const bounds = flow.getBoundingClientRect();
          const title = flow.querySelector(".cover-flow-title");
          const caption = title.getBoundingClientRect();
          const currentBounds = current.getBoundingClientRect();
          const meta = doc.querySelector(".track-meta").getBoundingClientRect();
          const seek = doc.querySelector("#seek").getBoundingClientRect();
          const topbar = doc.querySelector(".topbar").getBoundingClientRect();
          const wheel = doc.querySelector(".click-wheel").getBoundingClientRect();
          const toolbarGap = topbar.top - seek.bottom;
          const wheelGap = wheel.top - seek.bottom;
          const bottomGap = win.innerHeight - wheel.bottom;
          const metaGap = seek.top - meta.bottom;
          const titleFits = !title.closest(".cover-flow-card") && Math.abs(center(title) - center(current)) < 1 &&
            caption.width > 0 && caption.top >= currentBounds.bottom &&
            caption.bottom <= bounds.bottom && caption.bottom <= meta.top;
          const centerShare = currentBounds.width / bounds.width;
          const heightLimit = (bounds.height - 28) / bounds.width;
          const sideShare = next.getBoundingClientRect().width / currentBounds.width;
          const centered = Math.abs(center(current) - center(flow)) < 1;
          const depth = (node) => Number(win.getComputedStyle(node.parentElement).zIndex);
          const gap = (other, direction) => {
            const outgoing = current.getBoundingClientRect();
            const incoming = other.getBoundingClientRect();
            return direction === 1 ? incoming.left - outgoing.right : outgoing.left - incoming.right;
          };
          flow.dataset.dragging = "true";
          let swapGap = Infinity, rotationError = 0, swapsCleanly = true;
          const endpointOverlaps = [];
          for (const direction of [-1, 1]) {
            const other = art(direction);
            const turn = stationary[direction + 1];
            for (let frame = 0; frame <= 100; frame++) {
              const progress = frame / 100;
              flow.style.setProperty("--cover-drag", -direction * progress);
              const distance = gap(other, direction);
              if (frame === 0 || frame === 100) endpointOverlaps.push(-distance / bounds.width);
              if (frame >= 48 && frame <= 52) swapGap = Math.min(swapGap, distance);
              rotationError = Math.max(rotationError,
                Math.abs(angle(current) + turn * progress),
                Math.abs(angle(other) - turn * (1 - progress)));
              if (distance < 0 || frame === 49 || frame === 51)
                swapsCleanly &&= (depth(current) > depth(other)) === (frame < 50);
            }
          }
          flow.style.setProperty("--cover-drag", "-0.38");
          const draggedAngle = angle(next);
          flow.removeAttribute("data-dragging");
          flow.style.removeProperty("--cover-drag");
          for (const node of flow.querySelectorAll(".cover-flow-card")) {
            const offset = Number(node.dataset.offset) - 1;
            node.dataset.offset = offset;
            node.style.setProperty("--cover-offset", offset);
          }
          angle(next);
          const transitions = flow.getAnimations({ subtree: true }).filter(
            (animation) => animation.transitionProperty === "--cover-position");
          for (const animation of transitions) animation.pause();
          let settleGap = Infinity, settleError = 0, halfway;
          let settleSeparated = false, settleLayers = true;
          for (let time = 0; time <= 280; time += 5) {
            for (const animation of transitions) animation.currentTime = time;
            const outgoing = angle(current), incoming = angle(next);
            const progress = -outgoing / stationary[2];
            const distance = gap(next, 1);
            settleError = Math.max(settleError, Math.abs(outgoing - incoming + stationary[2]));
            if (progress >= 0.45 && progress <= 0.55) {
              settleSeparated = true;
              settleGap = Math.min(settleGap, distance);
            }
            if (distance < 0) settleLayers &&= (depth(current) > depth(next)) === (progress < 0.5);
            if (time === 140) halfway = angle(next);
          }
          return { stationary, titleFits, toolbarGap, wheelGap, bottomGap, metaGap, centerShare, heightLimit, width: bounds.width,
            sideShare, centered, swapsCleanly,
            swapGap, endpointOverlaps, rotationError, settleGap, settleSeparated, settleLayers,
            settleError, draggedAngle, halfway,
            settled: angle(next), animated: transitions.length > 0 };
        });
        document.querySelector("#layout-results").textContent = JSON.stringify(results);
      });
    </script>`,
    );
    for (const item of results) {
      const detail = JSON.stringify(item);
      const [left, middle, right] = item.stationary;
      assert(item.titleFits && item.centered && item.animated && item.swapsCleanly, detail);
      assert(item.toolbarGap >= 5 && item.wheelGap >= 28 && item.metaGap >= 0, detail);
      assert(Math.abs(item.bottomGap - 18) < 1, detail);
      assert(
        Math.abs(item.centerShare - Math.min(0.81, item.heightLimit, 440 / item.width)) < 0.001,
        detail,
      );
      assert(item.sideShare >= 0.25 && item.sideShare <= 0.29, detail);
      assert(left * right < 0 && Math.abs(middle) < 0.001, detail);
      assert(
        item.endpointOverlaps.every((overlap) => overlap > 0 && overlap < 0.08),
        detail,
      );
      assert(
        item.swapGap > 0 && item.settleSeparated && item.settleGap > 0 && item.settleLayers,
        detail,
      );
      assert(item.rotationError < 0.001 && item.settleError < 0.001, detail);
      assert(
        Math.abs(item.halfway) > 0.001 && Math.abs(item.halfway) < Math.abs(item.draggedAngle),
        detail,
      );
      assert(Math.abs(item.settled) < 0.001, detail);
    }
  },
);

for (const reducedMotion of [false, true]) {
  test(
    `navigation unrolls its frame with the selected button and pages crossfade (${reducedMotion ? "reduced motion" : "animated"})`,
    {
      skip: !browser && "Install Chrome/Chromium or set QMPLAY_TEST_BROWSER for motion checks",
      timeout: 40000,
    },
    async (t) => {
      const directory = await mkdtemp(path.join(os.tmpdir(), "qmplay-motion-"));
      t.after(() => rm(directory, { recursive: true, force: true }));
      const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
      const script = await bundledNavigation();
      const frames = [false, true].map((mobile) => {
        const srcDoc = `<!doctype html><html><head><style>${css}</style></head>
            <body class="${mobile ? "" : "desktop"}"><main class="player">
              <div id="navigation-root" style="display:contents"></div><section class="main-stage">
                <div class="listening-view"><div class="album-art"></div></div>
                <section class="search-view" hidden><h2>推荐电台</h2></section>
              </section><footer class="player-footer"></footer>
            </main><script>${script}\nwindow.navigationTest = window.installNavigation(${mobile});</script></body></html>`;
        return renderToStaticMarkup(
          createElement("iframe", {
            title: mobile ? "mobile" : "desktop",
            width: mobile ? 360 : 540,
            height: mobile ? 780 : 580,
            srcDoc,
          }),
        );
      });
      const html = `<!doctype html><html><body>${frames.join("")}
        <pre id="layout-results"></pre><script>
          window.addEventListener("load", async () => {
            const results = await Promise.all([...document.querySelectorAll("iframe")].map(async (frame) => {
              const doc = frame.contentDocument, win = frame.contentWindow;
              const style = (node) => win.getComputedStyle(node);
              const flush = () => doc.body.getBoundingClientRect();
              const finish = () => { flush(); doc.getAnimations().forEach((animation) => animation.finish()); flush(); };
              const sample = (time) => {
                flush();
                const animations = doc.getAnimations();
                animations.forEach((animation) => { animation.pause(); animation.currentTime = time; });
                flush();
                return animations;
              };
              finish();
              const control = doc.querySelector(".mode-control"), toggle = doc.querySelector("#mode-toggle");
              const frameNode = doc.querySelector(".mode-frame");
              const mobile = frame.title === "mobile";
              const verify = doc.querySelector("#verify-login").getBoundingClientRect();
              const neighbor = (mobile ? toggle : doc.querySelector("#minimize-window")).getBoundingClientRect();
              const close = doc.querySelector("#close-window").getBoundingClientRect();
              const playerBounds = doc.querySelector(".player").getBoundingClientRect();
              const loginAligned = verify.width === neighbor.width && verify.height === neighbor.height &&
                verify.top === neighbor.top && (mobile
                  ? verify.left - playerBounds.left === playerBounds.right - neighbor.right
                  : neighbor.left - verify.right === close.left - neighbor.right);
              const selectedDistance = mobile ? 48 : 96, chosenDistance = mobile ? 96 : 48;
              const fullSize = 196;
              const read = () => {
                const matrix = new win.DOMMatrix(style(toggle).transform);
                return { position: mobile ? -matrix.e : matrix.f,
                  size: frameNode.getBoundingClientRect()[mobile ? "width" : "height"],
                  opacity: Number(style(frameNode).opacity), toggleOpacity: style(toggle).opacity,
                  iconsOpacity: Number(style(doc.querySelector("#mode-menu")).opacity),
                  icons: Object.fromEntries([...doc.querySelectorAll(".mode-option:not([hidden])")].map(
                    (row) => [row.dataset.mode, Number(style(row).opacity)])) };
              };
              const near = (a, b) => Math.abs(a - b) < 0.1;
              // Start on a middle row, so the frame must continue after the button stops.
              toggle.click();
              finish();
              doc.querySelector('.mode-option[data-mode="liked"]').click();
              finish();
              toggle.click();
              sample(20);
              const appearing = read();
              const openingAnimations = sample(60);
              const unrolling = read();
              sample(90);
              const firstRevealed = read();
              const afterStopTime = 40 + selectedDistance / 1.2 + 20;
              sample(afterStopTime);
              const continuing = read();
              const unrollsInOrder = appearing.opacity > 0 && appearing.opacity < 1 && near(appearing.size, 52) &&
                near(appearing.position, 0) && near(unrolling.position, 24) &&
                near(unrolling.size - 52, unrolling.position) && near(continuing.position, selectedDistance) &&
                continuing.size > 52 + selectedDistance && continuing.size < fullSize &&
                near((continuing.size - unrolling.size) / (afterStopTime - 60), 1.2) &&
                Object.values(unrolling.icons).every((opacity) => opacity === 0);
              const revealsInOrder = mobile
                ? firstRevealed.icons.artist === 1 && firstRevealed.icons.radio === 0 && continuing.icons.radio === 0
                : firstRevealed.icons.home === 1 && firstRevealed.icons.radio === 0 &&
                  continuing.icons.radio === 1 && continuing.icons.artist === 0;
              const expansionDuration = Math.max(...openingAnimations.map((animation) => {
                const timing = animation.effect.getTiming();
                return Number(timing.delay) + Number(timing.duration);
              }), 0);
              finish();
              const expanded = { ...read(), iconOpacity: style(doc.querySelector('.mode-option[aria-checked="true"] .icon-slot')).opacity };
              doc.querySelector('.mode-option[data-mode="radio"]').click();
              sample(40);
              const disappearing = read();
              const closing = sample(120);
              const returning = read();
              const closesInOrder = disappearing.opacity === 1 && returning.opacity === 1 &&
                near(disappearing.size, fullSize - 24) && near(returning.size, fullSize - 72) &&
                near(disappearing.position, Math.min(chosenDistance, fullSize - 52 - 24)) &&
                near(returning.position, Math.min(chosenDistance, fullSize - 52 - 72));
              finish();
              const collapsed = { toggleOpacity: style(toggle).opacity, menuVisibility: style(doc.querySelector("#mode-menu")).visibility };
              // Check every selection, including changing rows: the edge reaches the chosen
              // button before carrying it home, and no visible icon overlaps the moving button.
              const rows = [...doc.querySelectorAll('.mode-option:not([hidden])')];
              const collapseFailures = [];
              for (const previousRow of rows) for (const chosenRow of rows) {
                win.navigationTest.app.setMenu(true);
                finish();
                previousRow.click();
                finish();
                win.navigationTest.app.setMenu(true);
                finish();
                const controlBounds = control.getBoundingClientRect();
                const chosenBounds = chosenRow.getBoundingClientRect();
                const distance = mobile ? controlBounds.left - chosenBounds.left : chosenBounds.top - controlBounds.top;
                const travelTime = (fullSize - 52) / 0.6;
                chosenRow.click();
                for (let time = 0; time <= travelTime + 80; time += 8) {
                  sample(time);
                  const state = read();
                  const extent = Math.max(0, fullSize - 52 - time * 0.6);
                  const toggleBounds = toggle.getBoundingClientRect();
                  const frameBounds = frameNode.getBoundingClientRect();
                  for (const row of rows) {
                    const icon = row.querySelector('.icon-slot');
                    if (Number(style(row).opacity) * Number(style(icon).opacity) * state.iconsOpacity < 0.001) continue;
                    const bounds = icon.getBoundingClientRect();
                    const overlapWidth = Math.min(bounds.right, frameBounds.right, toggleBounds.right) -
                      Math.max(bounds.left, frameBounds.left, toggleBounds.left);
                    const overlapHeight = Math.min(bounds.bottom, frameBounds.bottom, toggleBounds.bottom) -
                      Math.max(bounds.top, frameBounds.top, toggleBounds.top);
                    if (overlapWidth > 0.1 && overlapHeight > 0.1) {
                      collapseFailures.push({ from: previousRow.dataset.mode, to: chosenRow.dataset.mode, time,
                        overlap: row.dataset.mode, state });
                    }
                  }
                  if (!${reducedMotion} && (!near(state.size, 52 + extent) ||
                    !near(state.position, Math.min(distance, extent)) ||
                    (time <= travelTime && state.opacity !== 1))) {
                    collapseFailures.push({ from: previousRow.dataset.mode, to: chosenRow.dataset.mode, time, state });
                  }
                  if (!${reducedMotion} && time === 40 && distance < fullSize - 52) {
                    const outermost = mobile ? 'queue' : 'artist';
                    if (!near(state.icons[outermost], 0.5)) collapseFailures.push({ time, state, missingFade: outermost });
                  }
                  if (!${reducedMotion} && time === travelTime + 40 && !(state.opacity > 0 && state.opacity < 1)) {
                    collapseFailures.push({ time, state, missingFrameFade: true });
                  }
                }
                finish();
              }
              win.navigationTest.app.showRadio();
              finish();
              // Dismiss and reopen during travel: neither direction may jump to an endpoint.
              toggle.click();
              sample(60);
              const beforeReverse = read().position;
              win.navigationTest.app.setMenu(false);
              flush();
              const afterReverse = read().position;
              sample(40);
              const beforeReopen = read().position;
              win.navigationTest.app.setMenu(true);
              flush();
              const afterReopen = read().position;
              const reversesSmoothly = near(beforeReverse, afterReverse) && near(beforeReopen, afterReopen);
              finish();
              let captured = null;
              toggle.setPointerCapture = (id) => { captured = id; };
              toggle.hasPointerCapture = (id) => captured === id;
              toggle.releasePointerCapture = () => { captured = null; };
              const pointer = async (type, x, y) => {
                win.navigationTest.dispatch(new win.PointerEvent(type, {
                  bubbles: true, cancelable: true, pointerId: 7, isPrimary: true,
                  pointerType: "touch", button: 0, clientX: x, clientY: y,
                }));
                // Continuous pointer moves render on the next frame, as on an actual touchscreen.
                await new Promise((resolve) => win.setTimeout(resolve, 16));
              };
              let mobileDragWorks = true;
              const dragDetails = [];
              if (mobile) {
                const start = toggle.getBoundingClientRect();
                const x = start.left + 22, y = start.top + 22;
                await pointer("pointerdown", x, y);
                await pointer("pointermove", x + 54, y + 32);
                flush();
                const followsFinger = near(read().position, 42) && style(toggle).pointerEvents === "auto" &&
                  style(toggle).touchAction === "none" && read().iconsOpacity === 1 &&
                  toggle.getAttribute("aria-valuenow") === "2" && captured === 7;
                dragDetails.push({ phase: "move", ...read(), pointerEvents: style(toggle).pointerEvents, touchAction: style(toggle).touchAction,
                  value: toggle.getAttribute("aria-valuenow"), captured, dragging: control.dataset.dragging });
                await pointer("pointerup", x + 62, y + 76);
                toggle.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
                const chosen = win.navigationTest.getSnapshot().navigation;
                dragDetails.push({ phase: "chosen", ...chosen, captured });
                mobileDragWorks = followsFinger && chosen.view === "liked" && !chosen.menuOpen && captured === null;
                finish();
                const closed = toggle.getBoundingClientRect();
                await pointer("pointerdown", closed.left + 22, closed.top + 22);
                await pointer("pointermove", closed.left - 140, closed.top + 40);
                await pointer("pointerup", closed.left - 140, closed.top + 40);
                const swiped = win.navigationTest.getSnapshot().navigation;
                dragDetails.push({ phase: "swiped", ...swiped, captured });
                mobileDragWorks &&= swiped.view === "queue" && !swiped.menuOpen;
                finish();
                win.navigationTest.app.setMenu(true);
                finish();
                const active = toggle.getBoundingClientRect();
                await pointer("pointerdown", active.left + 22, active.top + 22);
                await pointer("pointermove", active.left + 76, active.top + 50);
                await pointer("pointercancel", active.left + 76, active.top + 50);
                finish();
                mobileDragWorks &&= near(read().position, 144) && control.dataset.dragging === "false" &&
                  win.navigationTest.getSnapshot().navigation.view === "queue";
                dragDetails.push({ phase: "cancelled", ...read(), ...win.navigationTest.getSnapshot().navigation, dragging: control.dataset.dragging });
              } else {
                await pointer("pointerdown", 22, 22);
                await pointer("pointermove", 120, 22);
                await pointer("pointerup", 120, 22);
                mobileDragWorks = captured === null && control.dataset.dragging === "false";
              }
              const player = doc.querySelector(".listening-view"), page = doc.querySelector(".search-view");
              const bounds = player.getBoundingClientRect();
              player.hidden = true;
              page.hidden = false;
              const outward = sample(120);
              const sharedCell = Math.abs(player.getBoundingClientRect().left - bounds.left) < 1 &&
                Math.abs(player.getBoundingClientRect().width - bounds.width) < 1;
              const crossfade = [player, page].every((node) => style(node).display !== "none" &&
                Number(style(node).opacity) > 0 && Number(style(node).opacity) < 1);
              finish();
              const finishedOutward = style(player).display === "none" && style(page).opacity === "1";
              page.hidden = true;
              player.hidden = false;
              const inward = sample(120);
              const reverseCrossfade = [player, page].every((node) => style(node).display !== "none" &&
                Number(style(node).opacity) > 0 && Number(style(node).opacity) < 1);
              // Reverse an unfinished transition, then settle it: no stale outgoing page remains.
              player.hidden = true;
              page.hidden = false;
              finish();
              if (mobile) {
                const active = toggle.getBoundingClientRect();
                await pointer("pointerdown", active.left + 22, active.top + 22);
              }
              win.navigationTest.unmount();
              const cleanedUp = captured === null && !doc.getAnimations().some((animation) => animation.effect.target === toggle);
              return { name: frame.title, loginAligned, expanded, collapsed, unrollsInOrder, revealsInOrder, closesInOrder, reversesSmoothly, cleanedUp,
                appearing, unrolling, firstRevealed, continuing, disappearing, returning, collapseFailures, expansionDuration, mobileDragWorks, dragDetails, crossfade, reverseCrossfade, sharedCell,
                finishedOutward, settled: style(player).display === "none" && style(page).opacity === "1",
                reduced: win.matchMedia("(prefers-reduced-motion: reduce)").matches,
                animationCount: openingAnimations.length + closing.length + outward.length + inward.length };
            }));
            document.querySelector("#layout-results").textContent = JSON.stringify(results);
          });
        </script></body></html>`;
      const measurements = await measureLayout(
        directory,
        html,
        reducedMotion ? ["--force-prefers-reduced-motion"] : [],
      );
      for (const item of measurements) {
        const detail = JSON.stringify(item);
        assert.equal(item.reduced, reducedMotion, detail);
        assert(item.loginAligned, detail);
        assert.equal(item.expanded.iconOpacity, item.name === "mobile" ? "1" : "0", detail);
        assert.equal(item.expanded.toggleOpacity, "1", detail);
        assert.equal(item.expanded.opacity, 1, detail);
        assert.equal(item.collapsed.toggleOpacity, "1", detail);
        assert.equal(item.collapsed.menuVisibility, "hidden", detail);
        assert.deepEqual(item.collapseFailures, [], detail);
        assert(
          item.finishedOutward && item.settled && item.cleanedUp && item.mobileDragWorks,
          detail,
        );
        if (reducedMotion) assert.equal(item.animationCount, 0, detail);
        else
          assert(
            item.expansionDuration === 160 &&
              item.unrollsInOrder &&
              item.revealsInOrder &&
              item.closesInOrder &&
              item.reversesSmoothly &&
              item.crossfade &&
              item.reverseCrossfade &&
              item.sharedCell,
            detail,
          );
      }
    },
  );
}
