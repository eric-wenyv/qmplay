import { useCallback } from "react";

interface PaletteColors {
  top: string;
  base: string;
  bottom: string;
}
interface Palette {
  shared: Pick<PaletteColors, "base" | "bottom">;
  background?: PaletteColors;
}
const palettes = new Map<string, Palette>();

/** Sampling is view-only: it cannot alter the selected track or playback state. */
export function useArtworkTheme() {
  return useCallback((image: HTMLImageElement) => {
    if (!image.complete || !image.naturalWidth) return;
    const key = image.currentSrc || image.src;
    let palette = palettes.get(key);
    if (!palette) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 32;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Canvas sampling unavailable");
        const crop = Math.min(image.naturalWidth, image.naturalHeight);
        context.drawImage(
          image,
          (image.naturalWidth - crop) / 2,
          (image.naturalHeight - crop) / 2,
          crop,
          crop,
          0,
          0,
          32,
          32,
        );
        const pixels = context.getImageData(0, 0, 32, 32).data;
        const average = (start: number, end: number, shade: number, colorWeight = 0) => {
          const sum = [0, 0, 0];
          let totalWeight = 0;
          for (let row = start; row < end; row++)
            for (let col = 0; col < 32; col++) {
              const offset = (row * 32 + col) * 4;
              if (pixels[offset + 3] < 128) continue;
              let weight = 1;
              if (colorWeight) {
                const red = pixels[offset];
                const green = pixels[offset + 1];
                const blue = pixels[offset + 2];
                weight += colorWeight * (Math.max(red, green, blue) - Math.min(red, green, blue));
              }
              for (let channel = 0; channel < 3; channel++)
                sum[channel] += pixels[offset + channel] * weight;
              totalWeight += weight;
            }
          return `rgb(${sum.map((value) => Math.round((value / Math.max(totalWeight, 1)) * shade)).join(" ")})`;
        };
        palette = {
          shared: {
            base: average(10, 27, 0.69),
            bottom: average(20, 32, 0.58),
          },
          background: {
            top: average(0, 10, 0.65, 0.1),
            base: average(15, 28, 0.7, 0.15),
            bottom: average(28, 32, 0.35),
          },
        };
        if (palettes.size >= 100) {
          const oldest = palettes.keys().next().value;
          if (oldest) palettes.delete(oldest);
        }
        palettes.set(key, palette);
      } catch {
        palette = { shared: { base: "#4d596b", bottom: "#343d50" } };
      }
    }
    const styles = document.documentElement.style;
    for (const [name, color] of Object.entries(palette.shared))
      styles.setProperty(`--cover-${name}`, color);
    for (const name of ["top", "base", "bottom"] as const) {
      const backgroundColor = palette.background?.[name];
      if (backgroundColor) styles.setProperty(`--background-cover-${name}`, backgroundColor);
      else styles.removeProperty(`--background-cover-${name}`);
    }
    const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (theme) theme.content = palette.shared.base;
  }, []);
}
