import { useEffect, useLayoutEffect, useRef } from "react";
import type { AppSnapshot, MusicApplication } from "../contracts.js";

export function focusElement(selector: string) {
  document.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
}

export function useKeyboard(app: MusicApplication, snapshot: AppSnapshot) {
  useEffect(() => {
    const dismiss = (event: Event) => {
      if (
        event.target instanceof Element &&
        !event.target.closest(".mode-control") &&
        app.getSnapshot().navigation.menuOpen
      )
        app.setMenu(false);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const state = app.getSnapshot();
      if (state.auth.state !== "ready") return;
      const { navigation } = state;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!navigation.queueOpen && !(navigation.mobile && navigation.menuOpen)) app.showSearch();
        return;
      }
      if (event.key === "Escape") {
        if (navigation.mobile && navigation.menuOpen) {
          app.setMenu(false);
          focusElement("#mode-toggle");
        } else if (navigation.queueOpen || navigation.view === "queue") app.closeQueue();
        else if (navigation.menuOpen) {
          app.setMenu(false);
          focusElement("#mode-toggle");
        } else if (navigation.view !== "player") app.returnToPlayer();
        return;
      }
      const modal =
        navigation.mobile && navigation.menuOpen
          ? "#mode-menu"
          : !navigation.mobile && navigation.queueOpen
            ? "#queue-panel"
            : null;
      if (modal) {
        if (event.key === "Tab") {
          const buttons = [
            ...document.querySelectorAll<HTMLButtonElement>(
              `${modal} button:not(:disabled):not([hidden])`,
            ),
          ];
          if (!buttons.length) return;
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = index + (event.shiftKey ? -1 : 1);
          if (navigation.menuOpen || next < 0 || next >= buttons.length || index < 0) {
            event.preventDefault();
            buttons[(next + buttons.length) % buttons.length]?.focus();
          }
        }
        return;
      }
      if (
        (event.target instanceof Element &&
          event.target.closest(
            "input, textarea, select, button, [role=button], [contenteditable]",
          )) ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      if (event.code === "Space") {
        event.preventDefault();
        app.togglePlay();
      }
      if (event.code === "ArrowRight") {
        event.preventDefault();
        void app.advance("next");
      }
      if (event.code === "ArrowLeft") {
        event.preventDefault();
        void app.advance("previous");
      }
    };
    document.addEventListener("keydown", keyboard);
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    return () => {
      document.removeEventListener("keydown", keyboard);
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
    };
  }, [app]);

  const previous = useRef(snapshot.navigation);
  useLayoutEffect(() => {
    const before = previous.current;
    const next = snapshot.navigation;
    if (next.menuOpen && !before.menuOpen) {
      const selected =
        document.querySelector<HTMLElement>('.mode-option[aria-checked="true"]:not([hidden])') ||
        document.querySelector<HTMLElement>(".mode-option:not([hidden])");
      selected?.focus({ preventScroll: true });
    } else if (
      (next.queueOpen && !before.queueOpen) ||
      (next.view === "queue" && before.view !== "queue")
    )
      focusElement(next.mobile ? "#queue-panel" : "#close-queue");
    else if (
      (before.queueOpen && !next.queueOpen) ||
      (before.view === "queue" && next.view !== "queue")
    )
      focusElement("#queue-toggle");
    else if (next.view !== before.view) {
      if (next.view === "search" && !next.mobile) focusElement("#search-input");
      else if (next.view === "albums") focusElement("#play-artist");
      else focusElement("#mode-toggle");
    } else if (before.menuOpen && !next.menuOpen && document.activeElement?.closest("#mode-menu"))
      focusElement("#mode-toggle");
    previous.current = next;
  }, [snapshot.navigation]);
}
