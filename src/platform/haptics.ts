import type { HapticEffect } from "./types.js";

export function playHaptic(effect: HapticEffect): void {
  window.qmplayAndroid?.haptic?.(effect);
}
