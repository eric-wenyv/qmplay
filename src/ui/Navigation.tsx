import { useRef, type CSSProperties } from "react";
import type { AppSnapshot, MusicApplication, NavigationMode, View } from "../contracts.js";
import { Icon } from "./Icon.js";
import { useNavigationMotion } from "./useNavigationMotion.js";
import { useNavigationDrag } from "./useNavigationDrag.js";

const mobileModes = ["queue", "radio", "liked", "artist"] as const;
const desktopModes = ["home", "radio", "liked", "artist"] as const;

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
  albumTracks: "artist",
  browse: "radio",
  liked: "liked",
  queue: "queue",
  player: "home",
  lyrics: "home",
} as const;

const pageLabels: Partial<Record<View, string>> = {
  search: "搜索歌手",
  albums: "歌手专辑",
  albumTracks: "专辑歌曲",
};

export function describePage(view: View) {
  const mode = pageModes[view];
  return { label: pageLabels[view] ?? labels[mode], icon: icons[mode] };
}

export function Navigation({
  app,
  snapshot,
  wide = false,
}: {
  app: MusicApplication;
  snapshot: AppSnapshot;
  wide?: boolean;
}) {
  const { navigation, auth } = snapshot;
  const verifying = snapshot.requests.auth || auth.state === "checking";
  const queueModal = auth.state === "ready" && !navigation.mobile && navigation.queueOpen;
  const loginButton = (
    <button
      id="verify-login"
      className={navigation.mobile ? "mode-toggle" : "icon-button"}
      type="button"
      aria-label={verifying ? "正在验证登录" : "验证登录"}
      aria-busy={verifying}
      data-tip="验证登录"
      disabled={verifying || auth.state === "authorizing" || auth.state === "loadingQr"}
      inert={navigation.mobile && navigation.menuOpen}
      onClick={() => void app.verifyAuthentication()}
    >
      <Icon name="verify" />
    </button>
  );
  const choose = (mode: NavigationMode) => {
    if (mode === "home") app.returnToPlayer();
    else if (mode === "artist") app.showSearch();
    else if (mode === "radio") void app.showRadio();
    else if (mode === "liked") app.showLiked();
    else if (mode === "queue") app.openQueue();
  };
  return (
    <>
      <header className="topbar" inert={queueModal}>
        {navigation.mobile && auth.state === "ready" && loginButton}
        {!wide && <CompactNavigation app={app} snapshot={snapshot} choose={choose} />}
        <div className="window-controls" aria-label="窗口控制" hidden={navigation.mobile}>
          {!navigation.mobile && loginButton}
          <button
            id="minimize-window"
            className="icon-button"
            type="button"
            aria-label="最小化"
            hidden={!window.qmplayDesktop}
            onClick={() => window.qmplayDesktop?.minimize()}
          >
            <Icon name="minus" />
          </button>
          <button
            id="close-window"
            className="icon-button"
            type="button"
            aria-label="关闭窗口"
            hidden={!window.qmplayDesktop}
            onClick={() => window.qmplayDesktop?.close()}
          >
            <Icon name="close" />
          </button>
        </div>
      </header>
      {wide && auth.state === "ready" && (
        <nav className="desktop-nav" aria-label="页面导航" inert={queueModal}>
          {desktopModes.map((mode) => (
            <button
              key={mode}
              type="button"
              data-mode={mode}
              aria-label={labels[mode]}
              data-tip={labels[mode]}
              aria-current={pageModes[navigation.view] === mode ? "page" : undefined}
              onClick={() => choose(mode)}
            >
              <Icon name={icons[mode]} />
            </button>
          ))}
        </nav>
      )}
    </>
  );
}

function CompactNavigation({
  app,
  snapshot,
  choose,
}: {
  app: MusicApplication;
  snapshot: AppSnapshot;
  choose: (mode: NavigationMode) => void;
}) {
  const { navigation, auth } = snapshot;
  const selected = navigation.mobile ? navigation.mobileMode : pageModes[navigation.view];
  const menuModes: readonly NavigationMode[] = navigation.mobile ? mobileModes : desktopModes;
  const lastStep = menuModes.length - 1;
  const selectedIndex = menuModes.indexOf(selected);
  const selectedStep = navigation.mobile ? lastStep - selectedIndex : selectedIndex;
  const control = useRef<HTMLDivElement>(null);
  const { dragging, preview, settled, handlers } = useNavigationDrag({
    control,
    enabled: navigation.mobile && auth.state === "ready",
    open: navigation.menuOpen,
    reveal: () => app.setMenu(true),
    choose,
  });
  useNavigationMotion(control, navigation.menuOpen, selected, navigation.mobile, dragging, settled);
  const slider = navigation.mobile && navigation.menuOpen;
  const sliderIndex = Math.max(
    0,
    mobileModes.findIndex((mode) => mode === (preview || selected)),
  );
  return (
    <div
      ref={control}
      className="mode-control"
      data-open={navigation.menuOpen}
      data-dragging={dragging}
      style={{ "--mode-selected-step": selectedStep } as CSSProperties}
      inert={auth.state !== "ready"}
      {...handlers}
    >
      <button
        id="mode-toggle"
        className="mode-toggle"
        type="button"
        role={slider ? "slider" : undefined}
        aria-label={slider ? "滑动切换页面" : `切换页面：${labels[selected]}`}
        aria-valuemin={slider ? 0 : undefined}
        aria-valuemax={slider ? lastStep : undefined}
        aria-valuenow={slider ? sliderIndex : undefined}
        aria-valuetext={slider ? labels[preview || selected] : undefined}
        aria-orientation={slider ? "horizontal" : undefined}
        aria-haspopup={slider ? undefined : "menu"}
        aria-expanded={slider ? undefined : navigation.menuOpen}
        aria-controls="mode-menu"
        data-tip={labels[selected]}
        inert={navigation.menuOpen && !slider}
        aria-hidden={navigation.menuOpen && !slider}
        onClick={() => (slider ? choose(selected) : app.setMenu(!navigation.menuOpen))}
        onKeyDown={(event) => {
          if (!slider || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const index =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? lastStep
                : Math.max(
                    0,
                    Math.min(lastStep, sliderIndex + (event.key === "ArrowRight" ? 1 : -1)),
                  );
          choose(mobileModes[index]!);
        }}
      >
        <Icon id="mode-icon" name={icons[selected]} />
        <span className="mode-dot" aria-hidden="true" />
      </button>
      <div className="mode-frame">
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
          {menuModes.map((mode, index) => {
            const step = navigation.mobile ? lastStep - index : index;
            const revealStep = step < selectedStep ? step + 1 : step;
            return (
              <button
                key={mode}
                className="mode-option"
                type="button"
                data-mode={mode}
                role="menuitemradio"
                aria-checked={selected === mode}
                data-preview={preview === mode}
                style={
                  {
                    "--mode-reveal-step": revealStep,
                    "--mode-hide-duration":
                      step > selectedStep ? "var(--mode-step-duration)" : "0s",
                  } as CSSProperties
                }
                aria-label={labels[mode]}
                data-tip={labels[mode]}
                onClick={() => choose(mode)}
              >
                <Icon name={icons[mode]} />
                <span className="mode-dot" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
