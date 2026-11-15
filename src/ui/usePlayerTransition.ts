import { useEffect, useMemo, useRef } from "react";
import { flushSync } from "react-dom";
import type { MusicApplication } from "../contracts.js";

export interface PlayerTransition {
  open(): void;
  dragDismiss(distance: number): void;
  endDismiss(commit: boolean): void;
}

interface Motion {
  artwork: HTMLElement;
  trackId: string | undefined;
  progress: number;
  dragOrigin: number | null;
  distance: number;
  hold(): void;
  set(progress: number): void;
  settle(progress: number, complete: () => void): void;
  dispose(): void;
}

/** Animate the real cover: no image replacement or compositor handoff at the player endpoint. */
export function usePlayerTransition(app: MusicApplication): PlayerTransition {
  const active = useRef<Motion | null>(null);
  const transition = useMemo(() => {
    const clear = () => {
      const motion = active.current;
      active.current = null;
      motion?.dispose();
    };
    const create = (): Motion | null => {
      const root = document.querySelector<HTMLElement>(".player.is-mobile");
      const artwork = root?.querySelector<HTMLElement>(
        ".cover-flow-card[data-offset='0'] .album-art",
      );
      const flight = artwork?.closest<HTMLElement>(".cover-flow-flight");
      const dock = root?.querySelector<HTMLElement>(".mobile-dock");
      const dockImage = dock?.querySelector<HTMLImageElement>(".dock-cover");
      const home = root?.querySelector<HTMLElement>("#browse-view");
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
      if (
        !root ||
        !artwork ||
        !flight ||
        !dock ||
        !dockImage ||
        !home ||
        reduce.matches ||
        !flight.animate
      )
        return null;
      const from = artwork.getBoundingClientRect();
      if (!from.width) return null;
      const original = {
        transform: flight.style.transform,
        radius: artwork.style.borderRadius,
        homeInert: home.hasAttribute("inert"),
        dockInert: dock.hasAttribute("inert"),
      };
      const radius = parseFloat(getComputedStyle(artwork).borderTopLeftRadius) || 0;
      root.dataset.playerMotion = "true";
      root.style.setProperty("--dismiss-progress", "0");
      home.setAttribute("inert", "");
      dock.setAttribute("inert", "");
      const to = dockImage.getBoundingClientRect();
      const dx = to.left + to.width / 2 - from.left - from.width / 2;
      const dy = to.top + to.height / 2 - from.top - from.height / 2;
      const targetScale = to.width / from.width;
      // A dismissed preview blends into the playing artwork without changing playback.
      const image = artwork.querySelector("img");
      const landing =
        image?.src !== dockImage.src ? (dockImage.cloneNode() as HTMLImageElement) : null;
      if (landing) {
        landing.className = "dismiss-artwork";
        landing.removeAttribute("id");
        landing.setAttribute("aria-hidden", "true");
        artwork.append(landing);
      }
      let animation: Animation | undefined;
      let rounding: Animation | undefined;
      let atmosphere: Animation | undefined;
      let imageBlend: Animation | undefined;
      let disposed = false;
      let start = 0;
      let end = 0;
      let generation = 0;
      const frame = (progress: number) => {
        const scale = 1 + (targetScale - 1) * progress;
        return {
          transform: `translate3d(${dx * progress}px, ${dy * progress}px, 0) scale3d(${scale}, ${scale}, 1)`,
          borderRadius: `${(radius + (to.width / 2 - radius) * progress) / scale}px`,
        };
      };
      const cancelAnimations = () => {
        generation++;
        if (animation) animation.onfinish = animation.oncancel = null;
        animation?.cancel();
        rounding?.cancel();
        atmosphere?.cancel();
        imageBlend?.cancel();
        animation = rounding = atmosphere = imageBlend = undefined;
      };
      const motion: Motion = {
        artwork,
        trackId: app.getSnapshot().playback.current?.id,
        progress: 0,
        dragOrigin: null,
        distance: Math.max(180, Math.min(460, Math.abs(dy))),
        hold() {
          if (animation) {
            const progress = animation.effect?.getComputedTiming().progress;
            this.set(start + (end - start) * (typeof progress === "number" ? progress : 0));
          }
          cancelAnimations();
        },
        set(progress) {
          this.progress = Math.max(0, Math.min(1, progress));
          const style = frame(this.progress);
          flight.style.transform = style.transform;
          artwork.style.borderRadius = style.borderRadius;
          root.style.setProperty("--dismiss-progress", String(this.progress));
          if (landing) landing.style.opacity = String(this.progress);
        },
        settle(progress, complete) {
          this.hold();
          start = this.progress;
          end = progress;
          const timing = {
            duration: Math.max(240, 1000 * Math.abs(end - start)),
            easing: "cubic-bezier(.22,.75,.2,1)",
            fill: "both" as const,
          };
          // Only transform this persistent layer; clipping and CoverFlow stay on the inner cover.
          animation = flight.animate(
            [{ transform: frame(start).transform }, { transform: frame(end).transform }],
            timing,
          );
          // Compensate for scale so the visible radius follows the finger-driven path.
          rounding = artwork.animate(
            Array.from({ length: 21 }, (_, index) => ({
              borderRadius: frame(start + ((end - start) * index) / 20).borderRadius,
            })),
            timing,
          );
          atmosphere = root.animate(
            [{ "--dismiss-progress": String(start) }, { "--dismiss-progress": String(end) }],
            timing,
          );
          if (landing) imageBlend = landing.animate([{ opacity: start }, { opacity: end }], timing);
          const current = ++generation;
          const finish = () => {
            if (disposed || generation !== current) return;
            this.set(end);
            cancelAnimations();
            complete();
          };
          animation.onfinish = finish;
          void animation.finished?.then(finish, () => {});
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          cancelAnimations();
          flight.style.transform = original.transform;
          artwork.style.borderRadius = original.radius;
          landing?.remove();
          delete root.dataset.playerMotion;
          root.style.removeProperty("--dismiss-progress");
          if (!original.homeInert) home.removeAttribute("inert");
          if (!original.dockInert) dock.removeAttribute("inert");
          reduce.removeEventListener("change", preference);
          window.removeEventListener("resize", clear);
        },
      };
      const preference = () => {
        if (reduce.matches) clear();
      };
      reduce.addEventListener("change", preference);
      window.addEventListener("resize", clear);
      return motion;
    };
    return {
      clear,
      open() {
        clear();
        flushSync(() => app.returnToPlayer());
        const motion = (active.current = create());
        if (!motion) return;
        motion.set(1);
        motion.settle(0, clear);
      },
      dragDismiss(distance: number) {
        let motion = active.current;
        if (!motion) motion = active.current = create();
        if (!motion) return;
        if (motion.dragOrigin === null) {
          motion.hold();
          motion.dragOrigin = motion.progress;
        }
        motion.set(motion.dragOrigin + Math.max(0, distance) / motion.distance);
      },
      endDismiss(commit: boolean) {
        const motion = active.current;
        if (!motion) {
          if (commit) void app.showRadio();
          return;
        }
        motion.dragOrigin = null;
        motion.settle(commit ? 1 : 0, () => {
          if (commit)
            flushSync(() => {
              void app.showRadio();
            });
          clear();
        });
      },
    };
  }, [app]);
  useEffect(() => {
    const unsubscribe = app.subscribe(() => {
      const motion = active.current;
      if (!motion) return;
      const state = app.getSnapshot();
      if (
        state.navigation.view !== "player" ||
        state.auth.state !== "ready" ||
        !state.navigation.mobile ||
        state.playback.current?.id !== motion.trackId
      )
        transition.clear();
    });
    return () => {
      unsubscribe();
      transition.clear();
    };
  }, [app, transition]);
  return transition;
}
