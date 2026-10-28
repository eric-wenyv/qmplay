import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
  type PointerEvent,
  type MouseEvent,
} from "react";
import type { NavigationMode } from "../contracts.js";

interface Drag {
  id: number;
  x: number;
  y: number;
  origin: number;
  wasOpen: boolean;
  moved: boolean;
  handle: HTMLElement;
  targets: { mode: NavigationMode; x: number }[];
}

function release(drag: Drag) {
  if (drag.handle.hasPointerCapture?.(drag.id)) drag.handle.releasePointerCapture(drag.id);
}

/** A mobile thumb follows the finger; release selects the nearest stop with generous vertical slack. */
export function useNavigationDrag({
  control,
  enabled,
  open,
  reveal,
  choose,
}: {
  control: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  open: boolean;
  reveal(): void;
  choose(mode: NavigationMode): void;
}) {
  const gesture = useRef<Drag | null>(null);
  const suppressClickUntil = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<NavigationMode | null>(null);
  const [settled, setSettled] = useState(0);
  const reset = useCallback(() => {
    const drag = gesture.current;
    gesture.current = null;
    if (drag) release(drag);
    if (drag?.moved) setSettled((version) => version + 1);
    setDragging(false);
    setPreview(null);
  }, []);
  useEffect(() => {
    if (gesture.current && (!enabled || !open)) reset();
  }, [enabled, open, reset]);
  useEffect(
    () => () => {
      const drag = gesture.current;
      gesture.current = null;
      if (drag) release(drag);
    },
    [],
  );
  const nearest = (drag: Drag, x: number) => {
    const position = Math.max(
      Math.min(...drag.targets.map((target) => target.x)),
      Math.min(Math.max(...drag.targets.map((target) => target.x)), drag.origin + x - drag.x),
    );
    return {
      position,
      target: drag.targets.reduce((best, target) =>
        Math.abs(target.x - position) < Math.abs(best.x - position) ? target : best,
      ),
    };
  };
  const cancel = (event: PointerEvent<HTMLElement>) => {
    const drag = gesture.current;
    if (!drag || drag.id !== event.pointerId) return;
    if (drag.moved) suppressClickUntil.current = Date.now() + 400;
    reset();
  };
  return {
    dragging,
    preview,
    settled,
    handlers: {
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (!enabled || !event.isPrimary || event.button !== 0 || gesture.current) return;
        const node = control.current;
        const handle =
          event.target instanceof Element
            ? event.target.closest<HTMLElement>("#mode-toggle")
            : null;
        if (!node || !handle) return;
        const bounds = node.getBoundingClientRect();
        const targets = [...node.querySelectorAll<HTMLElement>(".mode-option:not([hidden])")].map(
          (row) => ({
            mode: row.dataset.mode as NavigationMode,
            x: row.getBoundingClientRect().left - bounds.left,
          }),
        );
        if (!targets.length) return;
        suppressClickUntil.current = 0;
        gesture.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          origin: handle.getBoundingClientRect().left - bounds.left,
          wasOpen: open,
          moved: false,
          handle,
          targets,
        };
        handle.setPointerCapture?.(event.pointerId);
      },
      onPointerMove(event: PointerEvent<HTMLElement>) {
        const drag = gesture.current;
        if (!drag || drag.id !== event.pointerId) return;
        const dx = Math.abs(event.clientX - drag.x),
          dy = Math.abs(event.clientY - drag.y);
        if (!drag.moved) {
          if (dy > 12 && dy > dx) {
            suppressClickUntil.current = Date.now() + 400;
            reset();
            return;
          }
          if (dx < 6) return;
          drag.moved = true;
          setDragging(true);
          if (!drag.wasOpen) reveal();
        }
        event.preventDefault();
        const { position, target } = nearest(drag, event.clientX);
        drag.handle.getAnimations?.().forEach((animation) => animation.cancel());
        drag.handle.style.transform = `translate(${position}px, 0px)`;
        setPreview(target.mode);
      },
      onPointerUp(event: PointerEvent<HTMLElement>) {
        const drag = gesture.current;
        if (!drag || drag.id !== event.pointerId) return;
        if (!drag.moved) {
          reset();
          return;
        }
        const { target } = nearest(drag, event.clientX);
        event.preventDefault();
        suppressClickUntil.current = Date.now() + 400;
        reset();
        if (Math.abs(event.clientY - drag.y) <= 80) choose(target.mode);
      },
      onPointerCancel: cancel,
      onLostPointerCapture: cancel,
      onClickCapture(event: MouseEvent<HTMLElement>) {
        if (
          event.detail !== 0 &&
          Date.now() < suppressClickUntil.current &&
          event.target instanceof Element &&
          event.target.closest("#mode-toggle")
        ) {
          suppressClickUntil.current = 0;
          event.preventDefault();
          event.stopPropagation();
        }
      },
    },
  };
}
