import { memo, useCallback, useEffect, useRef } from "react";
import { artworkUrl } from "../api.js";
import { useArtworkTheme } from "./useArtworkTheme.js";

/** One sampler follows the playing track, independently of the visible page or cover preview. */
export const ArtworkBackground = memo(function ArtworkBackground({ cover }: { cover?: string }) {
  const image = useRef<HTMLImageElement>(null);
  const pending = useRef<number | undefined>(undefined);
  const theme = useArtworkTheme();
  const src = artworkUrl(cover || "");
  const scheduleTheme = useCallback(
    (node: HTMLImageElement) => {
      window.clearTimeout(pending.current);
      pending.current = undefined;
      if (!node.complete || !node.naturalWidth) return;
      const source = node.src;
      const timer = window.setTimeout(() => {
        void (node.decode?.() ?? Promise.resolve()).then(
          () => {
            if (pending.current === timer && node === image.current && node.src === source)
              theme(node);
          },
          () => {},
        );
      }, 400);
      pending.current = timer;
    },
    [theme],
  );
  useEffect(() => {
    if (image.current?.complete) scheduleTheme(image.current);
    return () => {
      window.clearTimeout(pending.current);
      pending.current = undefined;
    };
  }, [src, scheduleTheme]);
  return (
    <div className="artwork-background" hidden>
      <img
        ref={image}
        src={src}
        alt=""
        crossOrigin="anonymous"
        decoding="async"
        onLoad={(event) => scheduleTheme(event.currentTarget)}
      />
    </div>
  );
});
