import type { MusicApplication } from "../contracts.js";
import { Icon } from "./Icon.js";

export function SearchHistory({
  app,
  queries,
  onSearch,
  onEmpty,
}: {
  app: MusicApplication;
  queries: string[];
  onSearch(query: string): void;
  onEmpty?(): void;
}) {
  if (!queries.length) return null;
  return (
    <section className="search-history" aria-label="搜索历史">
      <header>
        <h2>搜索历史</h2>
        <button
          type="button"
          onClick={() => {
            onEmpty?.();
            app.clearSearchHistory();
          }}
        >
          清空历史
        </button>
      </header>
      <ul>
        {queries.map((query) => (
          <li key={query}>
            <button type="button" className="history-query" onClick={() => onSearch(query)}>
              {query}
            </button>
            <button
              type="button"
              className="history-remove"
              aria-label={`删除搜索历史：${query}`}
              onClick={() => {
                if (queries.length === 1) onEmpty?.();
                app.removeSearchHistory(query);
              }}
            >
              <Icon name="close" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
