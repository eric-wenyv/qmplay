import { useCallback } from "react";

interface Palette {
  top: string;
  base: string;
  bottom: string;
}
const palettes = new Map<string, Palette>();

/** Sampling is view-only: it cannot alter the selected track or playback state. */
export function useArtworkTheme() {
  return useCallback((image: HTMLImageElement) => {
    const artwork = image.closest<HTMLElement>(".album-art");
    if (!artwork || !image.complete || !image.naturalWidth) return;
    const style = getComputedStyle(artwork);
    const filter = style.getPropertyValue("--art-filter").trim() || "none";
    const scale = Number(style.getPropertyValue("--art-scale")) || 1;
    const key = `${image.currentSrc || image.src}|${artwork.dataset.art}`;
    let palette = palettes.get(key);
    if (!palette) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 32;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return;
        context.filter = filter;
        const crop = Math.min(image.naturalWidth, image.naturalHeight) / scale;
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
        const average = (start: number, end: number, shade: number) => {
          const sum = [0, 0, 0];
          let count = 0;
          for (let row = start; row < end; row++)
            for (let col = 0; col < 32; col++) {
              const offset = (row * 32 + col) * 4;
              if (pixels[offset + 3] < 128) continue;
              for (let channel = 0; channel < 3; channel++)
                sum[channel] += pixels[offset + channel];
              count++;
            }
          return `rgb(${sum.map((value) => Math.round((value / Math.max(count, 1)) * shade)).join(" ")})`;
        };
        palette = {
          top: average(0, 13, 0.64),
          base: average(10, 27, 0.69),
          bottom: average(20, 32, 0.58),
        };
        if (palettes.size > 100) {
          const oldest = palettes.keys().next().value;
          if (oldest) palettes.delete(oldest);
        }
        palettes.set(key, palette);
      } catch {
        return; /* Keep the previous palette when pixels are unavailable. */
      }
    }
    for (const [name, value] of Object.entries(palette))
      document.documentElement.style.setProperty(`--cover-${name}`, value);
    const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (theme) theme.content = palette.base;
  }, []);
}
