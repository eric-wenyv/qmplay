import { useEffect, useMemo, useRef } from "react";
import { flushSync } from "react-dom";
import type { MusicApplication, View } from "../contracts.js";
import { createPlayerSharedElements } from "./playerSharedElements.js";

export interface PlayerTransition {
  open(): void;
  dragOpen(distance: number): void;
  endOpen(commit: boolean, speed?: number): void;
  close(): void;
  dragDismiss(distance: number): void;
  endDismiss(commit: boolean): void;
}

interface Motion {
  trackId: string | undefined;
  view: View;
  progress: number;
  dragOrigin: number | null;
  distance: number;
  commitOpen?: () => void;
  hold(): void;
  set(progress: number): void;
  settle(progress: number, complete: () => void, speed?: number): void;
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
    const create = (direction: "opening" | "closing" | "drag-opening"): Motion | null => {
      const { navigation, playback } = app.getSnapshot();
      const dragOpening = direction === "drag-opening";
      const root = document.querySelector<HTMLElement>(".player.is-mobile");
      const artwork = root?.querySelector<HTMLElement>(
        ".cover-flow-card[data-offset='0'] .album-art",
      );
      const flight = artwork?.closest<HTMLElement>(".cover-flow-flight");
      const listening = artwork?.closest<HTMLElement>("#listening-view");
      const footer = root?.querySelector<HTMLElement>(".player-footer");
      const dock = root?.querySelector<HTMLElement>(".mobile-dock");
      const dockImage = dock?.querySelector<HTMLImageElement>(".dock-cover");
      const dockCover = dockImage?.parentElement;
      const page = navigation.mobilePage ?? "browse";
      const underlayId = page === "albumTracks" ? "album-tracks-view" : `${page}-view`;
      const underlay = document.getElementById(underlayId);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
      if (
        !root ||
        !artwork ||
        !flight ||
        !listening ||
        !footer ||
        !dock ||
        !dockImage ||
        !dockCover ||
        !underlay ||
        reduce.matches ||
        !flight.animate
      )
        return null;
      const locked = new Set<HTMLElement>();
      const lock = (node: HTMLElement) => {
        if (node.hasAttribute("inert")) return;
        locked.add(node);
        node.setAttribute("inert", "");
      };
      const unlock = (node: HTMLElement) => {
        if (locked.delete(node)) node.removeAttribute("inert");
      };
      const restoreLayout = () => {
        delete root.dataset.playerMotion;
        root.style.removeProperty("--dismiss-progress");
        delete underlay.dataset.playerUnderlay;
        locked.forEach(unlock);
      };
      root.dataset.playerMotion = direction;
      underlay.dataset.playerUnderlay = "";
      const from = artwork.getBoundingClientRect();
      if (!from.width) {
        restoreLayout();
        return null;
      }
      const original = {
        transform: flight.style.transform,
        radius: artwork.style.borderRadius,
      };
      const radius = parseFloat(getComputedStyle(artwork).borderTopLeftRadius) || 0;
      lock(underlay);
      if (dragOpening) {
        lock(listening);
        lock(footer);
      } else lock(dock);
      const to = dockCover.getBoundingClientRect();
      const dx = to.left + to.width / 2 - from.left - from.width / 2;
      const dy = to.top + to.height / 2 - from.top - from.height / 2;
      const targetScale = to.width / from.width;
      const removeSharedElements = createPlayerSharedElements(root);
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
        trackId: playback.current?.id,
        view: navigation.view,
        progress: 0,
        dragOrigin: null,
        distance: dragOpening
          ? Math.max(1, Math.abs(dy))
          : Math.max(180, Math.min(460, Math.abs(dy))),
        commitOpen: dragOpening
          ? () => {
              motion.view = "player";
              motion.commitOpen = undefined;
              root.dataset.playerMotion = "opening";
              unlock(listening);
              unlock(footer);
              lock(dock);
              flushSync(() => app.returnToPlayer());
            }
          : undefined,
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
        settle(progress, complete, speed = 0) {
          this.hold();
          start = this.progress;
          end = progress;
          const remaining = Math.abs(end - start);
          const pixels = remaining * this.distance;
          let duration = Math.max(110, 450 * remaining);
          let easing = "cubic-bezier(0.18, 0, 0.82, 1)";
          if (speed > 0.12 && pixels > 0) {
            duration = Math.min(duration, Math.max(110, (2.75 * pixels) / speed));
            // Match the release velocity at the start and bring it to zero at the end.
            const firstControl = Math.min(0.85, (0.22 * speed * duration) / pixels);
            easing = `cubic-bezier(0.22, ${firstControl}, 0.52, 1)`;
          }
          const timing = {
            duration,
            easing,
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
          removeSharedElements?.();
          restoreLayout();
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
    const open = () => {
      if (app.getSnapshot().navigation.view === "player") return;
      clear();
      flushSync(() => app.returnToPlayer());
      const motion = (active.current = create("opening"));
      if (!motion) return;
      motion.set(1);
      motion.settle(0, clear);
    };
    const finishDismiss = (commit: boolean) => {
      const motion = active.current;
      const back = () => {
        if (app.getSnapshot().navigation.view === "player") app.goBack();
      };
      if (!motion) {
        if (commit) back();
        return;
      }
      motion.dragOrigin = null;
      motion.settle(commit ? 1 : 0, () => {
        if (commit) flushSync(back);
        clear();
      });
    };
    return {
      clear,
      open,
      dragOpen(distance: number) {
        const { navigation } = app.getSnapshot();
        if (navigation.view === "player" || navigation.queueOpen || navigation.menuOpen) return;
        let motion = active.current;
        if (!motion) {
          motion = active.current = create("drag-opening");
          motion?.set(1);
        }
        if (!motion?.commitOpen) return;
        if (motion.dragOrigin === null) {
          motion.hold();
          motion.dragOrigin = motion.progress;
        }
        motion.set(motion.dragOrigin - Math.max(0, distance) / motion.distance);
      },
      endOpen(commit: boolean, speed = 0) {
        const motion = active.current;
        if (!motion?.commitOpen) {
          if (commit) open();
          return;
        }
        motion.dragOrigin = null;
        if (commit) motion.commitOpen();
        motion.settle(commit ? 0 : 1, clear, commit ? speed : 0);
      },
      close() {
        if (!active.current) active.current = create("closing");
        finishDismiss(true);
      },
      dragDismiss(distance: number) {
        let motion = active.current;
        if (!motion) motion = active.current = create("closing");
        if (!motion) return;
        if (motion.dragOrigin === null) {
          motion.hold();
          motion.dragOrigin = motion.progress;
        }
        motion.set(motion.dragOrigin + Math.max(0, distance) / motion.distance);
      },
      endDismiss: finishDismiss,
    };
  }, [app]);
  useEffect(() => {
    const unsubscribe = app.subscribe(() => {
      const motion = active.current;
      if (!motion) return;
      const state = app.getSnapshot();
      if (
        state.navigation.view !== motion.view ||
        state.navigation.queueOpen ||
        state.navigation.menuOpen ||
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
