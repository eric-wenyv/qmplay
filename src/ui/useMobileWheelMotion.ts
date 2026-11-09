import { useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import type { MusicApplication, PlayOrder } from "../contracts.js";
import { playHaptic } from "../platform/haptics.js";

const reduceMotionQuery = "(prefers-reduced-motion: reduce)";
const out = "cubic-bezier(0.2, 0.65, 0.3, 1)";
const touchSlop = 7;
const sectorHapticDelay = 32;

function positionWave(wave: HTMLDivElement, angle: number, delta: number, speed: number) {
  wave.style.setProperty("--wheel-wave-angle", `${angle}rad`);
  wave.dataset.tracking = "";
  if (delta === 0) return;
  wave.dataset.direction = delta > 0 ? "clockwise" : "counterclockwise";
  wave.style.setProperty("--wheel-wave-strength", String(0.55 + 0.45 * Math.min(speed / 7, 1)));
}

export function useMobileWheelMotion({
  active,
  app,
  trackKey,
  order,
  setScrubTime,
}: {
  active: boolean;
  app: MusicApplication;
  trackKey: string | undefined;
  order: PlayOrder;
  setScrubTime: (time: number | null) => void;
}) {
  const wheel = useRef<HTMLDivElement>(null);
  const wave = useRef<HTMLDivElement>(null);
  const cancelGesture = useRef<(() => boolean) | null>(null);
  const [scrubMode, setScrubMode] = useState<"seeking" | "cancel" | null>(null);
  const suppressClick = useRef(false);
  const previousOrder = useRef(order);
  const preference = useRef<MediaQueryList | null>(null);
  const animations = useRef(new Map<HTMLElement, Animation>());
  const captionTimer = useRef<number | undefined>(undefined);

  function animate(node: HTMLElement, frames: Keyframe[], duration: number) {
    if (!preference.current || preference.current.matches || !node.animate) return;
    animations.current.get(node)?.cancel();
    const animation = node.animate(frames, { duration, easing: out });
    animations.current.set(node, animation);
    animation.onfinish = () => {
      if (animations.current.get(node) === animation) animations.current.delete(node);
    };
  }

  useLayoutEffect(() => {
    const node = wheel.current;
    if (!active || !node) return;
    const media = window.matchMedia(reduceMotionQuery);
    preference.current = media;
    const cancelMotion = () => {
      for (const animation of animations.current.values()) animation.cancel();
      animations.current.clear();
    };
    const onPreference = () => {
      if (media.matches) cancelMotion();
    };
    media.addEventListener("change", onPreference);
    return () => {
      cancelMotion();
      node.removeAttribute("data-wheel-caption");
      window.clearTimeout(captionTimer.current);
      preference.current = null;
      media.removeEventListener("change", onPreference);
    };
  }, [active]);

  useLayoutEffect(() => {
    const node = wheel.current;
    const ripple = wave.current;
    if (!active || !node || !ripple) return;
    let drag: {
      id: number;
      button: HTMLButtonElement | null;
      bounds: DOMRect;
      x: number;
      y: number;
      radius: number;
      angle: number | null;
      pendingAngle: number;
      stamp: number;
      velocity: number;
      scrubbing: boolean;
      overCancel: boolean;
      trackId: string | undefined;
      index: number;
      duration: number;
      time: number;
    } | null = null;
    let sectorHapticTimer: number | undefined;

    const cancelSectorHaptic = () => {
      window.clearTimeout(sectorHapticTimer);
      sectorHapticTimer = undefined;
    };
    const pulseSector = () => {
      sectorHapticTimer = undefined;
      playHaptic("wheel-key");
    };

    const finish = (commit: boolean) => {
      if (!drag) return;
      const { id, button, scrubbing, trackId, index, duration, time } = drag;
      drag = null;
      cancelSectorHaptic();
      button?.removeAttribute("data-wheel-pressed");
      ripple.removeAttribute("data-tracking");
      if (node.hasPointerCapture?.(id)) node.releasePointerCapture(id);
      if (!scrubbing || !duration) return;
      setScrubMode(null);
      const playback = app.getSnapshot().playback;
      if (commit && playback.current?.id === trackId && playback.index === index) app.seek(time);
      setScrubTime(null);
    };
    cancelGesture.current = () => {
      if (!drag?.scrubbing || !drag.duration) return false;
      finish(false);
      return true;
    };

    const onDown = (event: globalThis.PointerEvent) => {
      if (drag || !event.isPrimary || event.button !== 0) return;
      suppressClick.current = false;
      const bounds = node.getBoundingClientRect();
      const dx = event.clientX - (bounds.left + bounds.width / 2);
      const dy = event.clientY - (bounds.top + bounds.height / 2);
      const button = event.target instanceof Element ? event.target.closest("button") : null;
      const playback = app.getSnapshot().playback;
      const duration = playback.current?.duration ?? 0;
      drag = {
        id: event.pointerId,
        button,
        bounds,
        x: event.clientX,
        y: event.clientY,
        radius: Math.hypot(dx, dy),
        angle: Math.atan2(dy, dx),
        pendingAngle: 0,
        stamp: event.timeStamp,
        velocity: 0,
        scrubbing: false,
        overCancel: false,
        trackId: playback.current?.id,
        index: playback.index,
        duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
        time: playback.elapsed,
      };
      if (!button || button.disabled) return;
      button.dataset.wheelPressed = "";
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
      if (button.id === "play-toggle") {
        playHaptic("play-key");
      } else {
        // Let a moving finger take over the ring before the virtual key actuates.
        sectorHapticTimer = window.setTimeout(pulseSector, sectorHapticDelay);
      }
    };

    const onMove = (event: globalThis.PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return;
      const { bounds, button } = drag;
      if (
        !suppressClick.current &&
        Math.hypot(event.clientX - drag.x, event.clientY - drag.y) >= touchSlop
      ) {
        suppressClick.current = true;
        cancelSectorHaptic();
        button?.removeAttribute("data-wheel-pressed");
      }
      if (button?.id === "play-toggle") return;

      const dx = event.clientX - (bounds.left + bounds.width / 2);
      const dy = event.clientY - (bounds.top + bounds.height / 2);
      const distance = Math.hypot(dx, dy);
      const radius = bounds.width / 2;
      const insideCenter = distance <= radius * 0.35;
      const overCancel = drag.scrubbing && drag.duration > 0 && insideCenter;
      if (overCancel !== drag.overCancel) {
        drag.overCancel = overCancel;
        setScrubMode(overCancel ? "cancel" : "seeking");
        setScrubTime(overCancel ? null : drag.time);
      }
      if (insideCenter || distance > radius * 1.08 || !radius) {
        drag.angle = null;
        drag.velocity = 0;
        drag.pendingAngle = 0;
        ripple.removeAttribute("data-tracking");
        return;
      }
      const angle = Math.atan2(dy, dx);
      const difference = drag.angle === null ? 0 : angle - drag.angle;
      const step = Math.atan2(Math.sin(difference), Math.cos(difference));
      const dt = Math.max(8, event.timeStamp - drag.stamp) / 1000;
      drag.angle = angle;
      drag.stamp = event.timeStamp;

      if (!drag.scrubbing) {
        drag.pendingAngle += step;
        if (Math.abs(drag.pendingAngle) * drag.radius < touchSlop) return;
        drag.scrubbing = true;
        if (drag.duration) setScrubMode("seeking");
        suppressClick.current = true;
        cancelSectorHaptic();
        button?.removeAttribute("data-wheel-pressed");
        if (event.isTrusted) node.setPointerCapture?.(event.pointerId);
      }

      // Angular distance sets the fine adjustment. Speed and acceleration add bounded gain.
      const speed = Math.abs(step) / dt;
      const previousSpeed = dt > 0.12 ? 0 : drag.velocity;
      const acceleration = Math.max(0, (speed - previousSpeed) / dt);
      drag.velocity = speed;
      const gain =
        1 + Math.min(1.8, Math.max(0, speed - 0.6) * 0.27) + Math.min(0.65, acceleration * 0.008);
      const delta = drag.pendingAngle || step;
      drag.pendingAngle = 0;
      positionWave(ripple, angle, delta, 0.7 * speed + 0.3 * previousSpeed);
      if (!drag.duration || delta === 0) return;
      drag.time = Math.max(0, Math.min(drag.duration, drag.time + delta * 5 * gain));
      setScrubTime(drag.time);
    };

    const onUp = (event: globalThis.PointerEvent) => {
      if (drag?.id !== event.pointerId) return;
      if (drag.scrubbing) onMove(event);
      else if (
        sectorHapticTimer !== undefined &&
        !suppressClick.current &&
        !drag.button?.disabled &&
        Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < touchSlop
      ) {
        cancelSectorHaptic();
        pulseSector();
      }
      finish(!drag.overCancel);
    };
    const onCancel = (event: globalThis.PointerEvent) => {
      if (drag?.id !== event.pointerId) return;
      suppressClick.current = true;
      finish(false);
    };
    const onLeave = (event: globalThis.PointerEvent) => {
      if (!drag?.scrubbing) onCancel(event);
    };
    const onLostCapture = (event: globalThis.PointerEvent) => {
      if (event.target === node) onCancel(event);
    };
    const onBlur = () => {
      if (drag) suppressClick.current = true;
      finish(false);
    };

    node.addEventListener("pointerdown", onDown);
    node.addEventListener("pointermove", onMove);
    node.addEventListener("pointerleave", onLeave);
    node.addEventListener("lostpointercapture", onLostCapture);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onBlur);
    return () => {
      onBlur();
      cancelGesture.current = null;
      node.removeEventListener("pointerdown", onDown);
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerleave", onLeave);
      node.removeEventListener("lostpointercapture", onLostCapture);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onBlur);
    };
  }, [active, app, trackKey, setScrubTime]);

  useLayoutEffect(() => {
    const before = previousOrder.current;
    previousOrder.current = order;
    const node = wheel.current;
    if (!active || !node || before === order) return;
    const icons = node.querySelectorAll<HTMLElement>("[data-wheel-order]");
    for (const icon of icons) {
      const incoming = icon.dataset.wheelOrder === order;
      const outgoing = icon.dataset.wheelOrder === before;
      if (!incoming && !outgoing) {
        animations.current.get(icon)?.cancel();
        animations.current.delete(icon);
        continue;
      }
      const live = animations.current.has(icon) ? getComputedStyle(icon) : null;
      const start = {
        transform: live?.transform || (incoming ? "translate(11px, -4px) rotate(23deg)" : "none"),
        opacity: live ? Number(live.opacity) : incoming ? 0 : 1,
      };
      const end = incoming
        ? [
            { transform: "translate(-1.5px, 0) rotate(-4deg)", opacity: 1, offset: 0.73 },
            { transform: "none", opacity: 1 },
          ]
        : [{ transform: "translate(-11px, -4px) rotate(-23deg)", opacity: 0 }];
      animate(icon, [start, ...end], incoming ? 255 : 170);
    }
    node.dataset.wheelCaption = "visible";
    window.clearTimeout(captionTimer.current);
    captionTimer.current = window.setTimeout(
      () => node.removeAttribute("data-wheel-caption"),
      1000,
    );
  }, [active, order]);

  return {
    wheel,
    wave,
    scrubMode,
    cancelScrub() {
      return cancelGesture.current?.() ?? false;
    },
    onClickCapture(event: MouseEvent<HTMLDivElement>) {
      if (!active || !suppressClick.current || event.detail === 0) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    releaseFeedback(button: HTMLButtonElement) {
      animate(button, [{ "--wheel-release": "1" }, { "--wheel-release": "0" }], 160);
    },
  };
}
