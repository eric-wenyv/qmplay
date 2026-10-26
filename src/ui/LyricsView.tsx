import { useEffect, useRef } from "react";
import type { AppSnapshot, MusicApplication } from "../contracts.js";

export function LyricsView({ app, snapshot }: { app: MusicApplication; snapshot: AppSnapshot }) {
  const lines = useRef<HTMLDivElement>(null);
  const active = snapshot.lyrics.findLastIndex((line) => line.time <= snapshot.playback.elapsed);
  const visible = snapshot.navigation.view === "lyrics";
  useEffect(() => {
    const node = lines.current;
    const target = node?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!visible || !node || !target) return;
    node.scrollTo?.({
      top: target.offsetTop - node.offsetTop - node.clientHeight / 2 + target.clientHeight / 2,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [active, visible, snapshot.playback.current?.id]);
  return (
    <section id="lyrics-view" className="search-view" aria-label="歌词" hidden={!visible}>
      <div className="browse-heading">
        <h2 id="lyrics-title">{snapshot.playback.current?.title || "歌词"}</h2>
      </div>
      <div
        ref={lines}
        id="lyrics-lines"
        className="lyrics-lines"
        aria-busy={snapshot.requests.lyrics}
      >
        {snapshot.requests.lyrics ? (
          <p className="results-message">正在加载歌词…</p>
        ) : snapshot.lyrics.length ? (
          snapshot.lyrics.map((line, index) => (
            <button
              key={`${line.time}:${index}`}
              className="lyric-line"
              type="button"
              data-time={line.time}
              aria-current={index === active}
              onClick={() => app.seek(line.time)}
            >
              {line.text}
            </button>
          ))
        ) : (
          <p className="results-message">纯音乐或暂无歌词</p>
        )}
      </div>
    </section>
  );
}
