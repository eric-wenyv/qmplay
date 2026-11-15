import { icon } from "../icons.js";

const progress = "var(--dismiss-progress)";
const interpolate = (player: number, dock: number, unit = "px") =>
  `calc(${player}${unit} + ${dock - player}${unit} * ${progress})`;
const blend = (player: string, dock: string) =>
  `color-mix(in srgb, ${dock} calc(100% * ${progress}), ${player})`;

function appendIcon(parent: HTMLElement, name: string, className?: string) {
  const glyph = document.createElement("span");
  if (className) glyph.className = className;
  glyph.innerHTML = icon(name);
  parent.append(glyph);
}

/** Position visual copies above the wheel's clipped sectors using the cover's progress. */
export function createPlayerSharedElements(root: HTMLElement) {
  const pairs = [
    ["title", "#track-title", ".dock-copy > strong"],
    ["artist", "#track-artist", ".dock-copy > span"],
    ["like", "#like-toggle > .icon-slot", ".dock-like > .icon-slot"],
    ["play", ".wheel-play-face", ".dock-play > .icon-slot"],
    ["queue", "#home-toggle > .icon-slot", "#dock-queue-toggle > .icon-slot"],
  ] as const;
  const wheelGlyph = root.querySelector<HTMLElement>(".wheel-play-triangle");
  if (!wheelGlyph?.offsetWidth) return;
  const origin = root.getBoundingClientRect();
  const layer = document.createElement("div");
  layer.className = "player-shared-elements";
  layer.setAttribute("aria-hidden", "true");

  for (const [name, playerSelector, dockSelector] of pairs) {
    const player = root.querySelector<HTMLElement>(playerSelector);
    const dock = root.querySelector<HTMLElement>(dockSelector);
    if (!player || !dock) return;
    const isText = name === "title" || name === "artist";
    const from = player.getBoundingClientRect();
    const to = dock.getBoundingClientRect();
    if ((!isText && !from.height) || !to.height) return;
    const copy = document.createElement("div");
    copy.className = isText ? "player-shared-text" : "player-shared-control";
    copy.dataset.sharedPart = name;
    const startX = from.left + (isText ? 0 : from.width / 2);
    const endX = to.left + (isText ? 0 : to.width / 2);
    const startY = from.top + from.height / 2;
    const endY = to.top + to.height / 2;
    copy.style.left = `${startX - origin.left - root.clientLeft}px`;
    copy.style.top = `${startY - origin.top - root.clientTop}px`;
    copy.style.transform = `translate3d(${interpolate(0, endX - startX)}, ${interpolate(0, endY - startY)}, 0)`;
    copy.style.width = interpolate(from.width, to.width);
    copy.style.height = interpolate(from.height, to.height);
    const playerStyle = getComputedStyle(player);
    const dockStyle = getComputedStyle(dock);
    copy.style.color = blend(playerStyle.color, dockStyle.color);

    if (isText) {
      copy.style.fontSize = interpolate(
        parseFloat(playerStyle.fontSize),
        parseFloat(dockStyle.fontSize),
      );
      copy.style.fontWeight = interpolate(
        Number(playerStyle.fontWeight),
        Number(dockStyle.fontWeight),
        "",
      );
      copy.style.letterSpacing = interpolate(
        parseFloat(playerStyle.letterSpacing) || 0,
        parseFloat(dockStyle.letterSpacing) || 0,
      );
      copy.style.lineHeight = copy.style.height;
      const source = name === "artist" ? player.querySelector("#track-singer") : player;
      const playerText = source?.textContent ?? "";
      const text = document.createElement("span");
      text.textContent = playerText;
      copy.append(text);
      // The dock supplies a fallback when a track has no artist name.
      if (playerText !== dock.textContent) {
        const alternate = document.createElement("span");
        alternate.textContent = dock.textContent;
        text.style.opacity = `calc(1 - ${progress})`;
        alternate.style.opacity = progress;
        copy.append(alternate);
      }
    } else if (name === "play") {
      copy.style.setProperty("--shared-play-size", interpolate(wheelGlyph.offsetWidth, to.width));
      copy.style.setProperty(
        "--shared-play-face",
        blend(playerStyle.backgroundColor, "transparent"),
      );
      appendIcon(copy, "play", "shared-play-triangle");
      appendIcon(copy, "pause", "shared-play-pause");
      const square = document.createElement("span");
      square.className = "shared-play-cancel wheel-cancel-square";
      copy.append(square);
      appendIcon(copy, "close", "shared-play-scrub");
    } else appendIcon(copy, name === "like" ? "heart" : "queue");
    layer.append(copy);
  }

  root.append(layer);
  root.dataset.playerShared = "";
  return () => {
    layer.remove();
    delete root.dataset.playerShared;
  };
}
