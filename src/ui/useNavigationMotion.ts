import { useLayoutEffect, useRef, type RefObject } from "react";
import type { NavigationMode } from "../contracts.js";

interface MotionState {
  open: boolean;
  selected: NavigationMode;
  mobile: boolean;
  transform: string;
  dragging: boolean;
  settled: number;
}

/** The frame fades first; the same selected button then travels between its two positions. */
export function useNavigationMotion(
  control: RefObject<HTMLDivElement | null>,
  open: boolean,
  selected: NavigationMode,
  mobile: boolean,
  dragging: boolean,
  settled: number,
) {
  const previous = useRef<MotionState | null>(null);
  useLayoutEffect(() => {
    const node = control.current;
    const toggle = node?.querySelector<HTMLElement>("#mode-toggle");
    const menu = node?.querySelector<HTMLElement>("#mode-menu");
    const row = node?.querySelector<HTMLElement>('.mode-option[aria-checked="true"]:not([hidden])');
    if (!node || !toggle || !menu) return;
    const bounds = node.getBoundingClientRect();
    const rowBounds = row?.getBoundingClientRect();
    const position = rowBounds
      ? `translate(${rowBounds.left - bounds.left}px, ${rowBounds.top - bounds.top}px)`
      : "translate(0px, 0px)";
    const before = previous.current;
    const destination = open && row ? position : "translate(0px, 0px)";
    // Choosing another page transfers the visible button to the clicked row before it returns.
    const origin =
      !before?.dragging &&
      before?.settled === settled &&
      before?.open &&
      !open &&
      before.selected !== selected
        ? position
        : before?.transform || destination;
    const state = { open, selected, mobile, transform: destination, dragging, settled };
    previous.current = state;
    const timing = window.getComputedStyle(node);
    const frameDuration = parseFloat(timing.getPropertyValue("--mode-frame-duration")) || 80;
    const stepDuration = parseFloat(timing.getPropertyValue("--mode-step-duration")) || 80;
    const step =
      (parseFloat(timing.getPropertyValue("--mode-size")) || 44) +
      (parseFloat(timing.getPropertyValue("--mode-padding")) || 4);
    if (!dragging) toggle.style.transform = destination;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let animation: Animation | undefined;
    if (
      before &&
      before.mobile === mobile &&
      (before.open !== open || before.dragging || before.settled !== settled) &&
      !dragging &&
      row &&
      !reducedMotion.matches &&
      typeof toggle.animate === "function"
    ) {
      const from = new DOMMatrixReadOnly(origin);
      const to = new DOMMatrixReadOnly(destination);
      const distance = Math.hypot(to.e - from.e, to.f - from.f);
      if (distance > 0)
        animation = toggle.animate([{ transform: origin }, { transform: destination }], {
          delay: before.open !== open ? frameDuration : 0,
          duration: (distance / step) * stepDuration,
          easing: "linear",
          fill: "both",
        });
    }
    const reduce = () => {
      if (reducedMotion.matches) animation?.cancel();
    };
    reducedMotion.addEventListener("change", reduce);
    return () => {
      // Capture the current interpolated position before cancellation, so reversal stays smooth.
      state.transform = window.getComputedStyle(toggle).transform;
      animation?.cancel();
      reducedMotion.removeEventListener("change", reduce);
    };
  }, [control, open, selected, mobile, dragging, settled]);
}
