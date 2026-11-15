import { useEffect, useRef } from "react";
import { artworkUrl } from "../api.js";
import { useArtworkTheme } from "./useArtworkTheme.js";

/** One sampler follows the playing track, independently of the visible page or cover preview. */
export function ArtworkBackground({ cover }: { cover: string | undefined }) {
  const image = useRef<HTMLImageElement>(null);
  const theme = useArtworkTheme();
  useEffect(() => {
    if (image.current) theme(image.current);
  }, [cover, theme]);
  return (
    <div className="artwork-background" aria-hidden="true">
      <img
        ref={image}
        src={artworkUrl(cover || "")}
        alt=""
        crossOrigin="anonymous"
        onLoad={(event) => theme(event.currentTarget)}
      />
      <i className="ambient-blob blob-one" />
      <i className="ambient-blob blob-two" />
      <i className="ambient-blob blob-three" />
      <div className="ambient-shade" />
    </div>
  );
}
