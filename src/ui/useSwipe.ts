import { useRef, type PointerEvent, type MouseEvent } from "react";
import type { MusicApplication, View } from "../contracts.js";

interface SwipeStart {
  id: number;
  x: number;
  y: number;
  view: View;
}

/** Touch gestures navigate existing pages; they never select a playback source. */
export function useSwipe(app: MusicApplication) {
  const start = useRef<SwipeStart | null>(null);
  const suppressClickUntil = useRef(0);
  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      start.current = null;
      const state = app.getSnapshot();
      if (
        !state.navigation.mobile ||
        state.auth.state !== "ready" ||
        state.navigation.menuOpen ||
        (state.navigation.view === "player" && !state.navigation.mobilePage) ||
        event.pointerType === "mouse" ||
        !event.isPrimary ||
        (event.target instanceof Element &&
          event.target.closest("input, textarea, select, [contenteditable]"))
      )
        return;
      start.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        view: state.navigation.view,
      };
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const gesture = start.current;
      if (!gesture || gesture.id !== event.pointerId) return;
      const dx = event.clientX - gesture.x;
      const dy = Math.abs(event.clientY - gesture.y);
      if (dy > 12 && dy >= Math.abs(dx)) start.current = null;
    },
    onPointerCancel() {
      start.current = null;
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const gesture = start.current;
      start.current = null;
      const state = app.getSnapshot().navigation;
      if (
        !state.mobile ||
        !gesture ||
        gesture.id !== event.pointerId ||
        gesture.view !== state.view ||
        state.menuOpen
      )
        return;
      const dx = event.clientX - gesture.x;
      const dy = Math.abs(event.clientY - gesture.y);
      const returning = state.view !== "player" && dx >= 72;
      const resuming = state.view === "player" && dx <= -72;
      if ((!returning && !resuming) || Math.abs(dx) < dy * 2) return;
      suppressClickUntil.current = Date.now() + 400;
      event.preventDefault();
      if (returning) app.returnToPlayer();
      else app.resumeMobilePage();
    },
    onClickCapture(event: MouseEvent<HTMLElement>) {
      if (app.getSnapshot().navigation.mobile && Date.now() < suppressClickUntil.current) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };
}
