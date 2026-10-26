import { useLayoutEffect, useRef } from "react";
import type { AppSnapshot, MusicApplication, NavigationMode } from "../contracts.js";
import { Icon } from "./Icon.js";

const labels: Record<NavigationMode, string> = {
  home: "主页",
  radio: "推荐电台",
  liked: "喜欢的音乐",
  artist: "歌手电台",
  queue: "播放队列",
};
const icons: Record<NavigationMode, string> = {
  home: "home",
  radio: "radio",
  liked: "heart",
  artist: "artist",
  queue: "queue",
};
const pageModes = {
  search: "artist",
  albums: "artist",
  browse: "radio",
  liked: "liked",
  queue: "queue",
  player: "home",
  lyrics: "home",
} as const;

export function Navigation({ app, snapshot }: { app: MusicApplication; snapshot: AppSnapshot }) {
  const { navigation, auth } = snapshot;
  const control = useRef<HTMLDivElement>(null);
  const selected = navigation.mobile ? navigation.mobileMode : pageModes[navigation.view];
  useLayoutEffect(() => {
    const node = control.current;
    const row = node?.querySelector<HTMLElement>('.mode-option[aria-checked="true"]:not([hidden])');
    const menu = node?.querySelector<HTMLElement>("#mode-menu");
    const toggle = node?.querySelector<HTMLElement>("#mode-toggle");
    if (!node || !row || !menu || !toggle) return;
    node.style.setProperty(
      "--mode-selected-offset",
      `${row.offsetTop + menu.offsetTop - toggle.offsetTop}px`,
    );
    node.style.setProperty(
      "--mode-selected-x",
      `${row.offsetLeft + menu.offsetLeft - toggle.offsetLeft}px`,
    );
  }, [selected, navigation.mobile, navigation.menuOpen]);
  const choose = (mode: NavigationMode) => {
    app.setMenu(false);
    if (mode === "home") app.returnToPlayer();
    else if (mode === "artist") app.showSearch();
    else if (mode === "radio") void app.showRadio();
    else if (mode === "liked") app.showLiked();
  };
  return (
    <header className="topbar" inert={!navigation.mobile && navigation.queueOpen}>
      <div
        ref={control}
        className="mode-control"
        data-open={navigation.menuOpen}
        data-selection={selected !== "queue"}
        inert={auth.state !== "ready"}
      >
        <button
          id="mode-toggle"
          className="mode-toggle"
          type="button"
          aria-label={`切换页面：${labels[selected]}`}
          aria-haspopup="menu"
          aria-expanded={navigation.menuOpen}
          aria-controls="mode-menu"
          data-tip={labels[selected]}
          inert={navigation.menuOpen}
          aria-hidden={navigation.menuOpen}
          onClick={() => app.setMenu(!navigation.menuOpen)}
        >
          <Icon id="mode-icon" name={icons[selected]} />
          <span className="mode-dot" aria-hidden="true" />
        </button>
        <div
          id="mode-menu"
          className="mode-menu"
          role="menu"
          aria-label="页面导航"
          aria-hidden={!navigation.menuOpen}
          inert={!navigation.menuOpen}
          onKeyDown={(event) => {
            if (
              !["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(
                event.key,
              )
            )
              return;
            event.preventDefault();
            const buttons = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                ".mode-option:not([hidden])",
              ),
            ];
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : (index +
                      (["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1) +
                      buttons.length) %
                    buttons.length;
            buttons[next]?.focus();
          }}
        >
          {(["home", "radio", "liked", "artist"] as const).map((mode) => (
            <button
              key={mode}
              className="mode-option"
              type="button"
              data-mode={mode}
              role="menuitemradio"
              aria-checked={selected === mode}
              aria-label={labels[mode]}
              data-tip={labels[mode]}
              hidden={navigation.mobile && mode === "home"}
              onClick={() => choose(mode)}
            >
              <Icon name={icons[mode]} />
              <span className="mode-dot" />
            </button>
          ))}
        </div>
      </div>
      <div className="window-controls" aria-label="窗口控制" hidden={!window.qmplayDesktop}>
        <button
          id="minimize-window"
          className="icon-button"
          type="button"
          aria-label="最小化"
          onClick={() => window.qmplayDesktop?.minimize()}
        >
          <Icon name="minus" />
        </button>
        <button
          id="close-window"
          className="icon-button"
          type="button"
          aria-label="关闭窗口"
          onClick={() => window.qmplayDesktop?.close()}
        >
          <Icon name="close" />
        </button>
      </div>
    </header>
  );
}
