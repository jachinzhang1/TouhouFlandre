import {
  ArrowDown,
  ArrowUp,
  ArrowDownAZ,
  LayoutGrid,
  List,
  ListOrdered,
  Loader2,
  Search,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { CharacterSort, SortDirection } from "@touhoufriberg/shared";
import { CharacterAvatar } from "../components/CharacterAvatar";
import { useCharacterSearch } from "../hooks/useCharacterSearch";

type CharacterView = "grid" | "list";

const joinValues = (values: string[]) => values.join("、");
const initialParams = new URLSearchParams(window.location.search);
const initialView: CharacterView =
  initialParams.get("view") === "list" ? "list" : "grid";
const initialSort: CharacterSort =
  initialParams.get("sort") === "name" ? "name" : "appearance";
const initialDirection: SortDirection =
  initialParams.get("direction") === "desc" ? "desc" : "asc";

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<CharacterView>(initialView);
  const [sort, setSort] = useState<CharacterSort>(initialSort);
  const [direction, setDirection] = useState<SortDirection>(initialDirection);
  const { error, loading, results, total } = useCharacterSearch(query, {
    limit: 250,
    sort,
    direction,
  });

  const nextView = view === "grid" ? "list" : "grid";
  const nextSort = sort === "name" ? "appearance" : "name";
  const nextDirection = direction === "asc" ? "desc" : "asc";
  const ViewIcon = nextView === "list" ? List : LayoutGrid;
  const SortIcon = sort === "name" ? ArrowDownAZ : ListOrdered;
  const DirectionIcon = direction === "asc" ? ArrowUp : ArrowDown;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("view", view);
    params.set("sort", sort);
    params.set("direction", direction);
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}?${params.toString()}`,
    );
  }, [direction, sort, view]);

  return (
    <section className="page-panel search-page" aria-busy={loading}>
      <div className="page-heading">
        <p className="kicker">ARCHIVE</p>
        <h1>角色搜索</h1>
        <p>浏览当前题库中的可猜角色。</p>
      </div>

      <div className="catalog-querybar">
        <label className="search-box standalone">
          <Search size={18} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="例如 灵梦 / Reimu / 红白"
            aria-label="搜索角色"
          />
        </label>
        <div className="catalog-tools" aria-label="角色目录显示设置">
          <button
            className="catalog-tool"
            type="button"
            onClick={() => setView(nextView)}
            title={`切换到${nextView === "list" ? "列表" : "图标"}视图`}
          >
            <ViewIcon size={17} aria-hidden="true" />
            <span>{view === "grid" ? "图标" : "列表"}</span>
          </button>
          <button
            className="catalog-tool"
            type="button"
            onClick={() => setSort(nextSort)}
            title={`改为按${nextSort === "name" ? "名称" : "登场作品顺序"}排序`}
          >
            <SortIcon size={17} aria-hidden="true" />
            <span>{sort === "name" ? "名称" : "登场顺序"}</span>
          </button>
          <button
            className="catalog-tool"
            type="button"
            onClick={() => setDirection(nextDirection)}
            title={`改为${nextDirection === "asc" ? "正序" : "倒序"}`}
          >
            <DirectionIcon size={17} aria-hidden="true" />
            <span>{direction === "asc" ? "正序" : "倒序"}</span>
          </button>
        </div>
      </div>

      {error ? <p className="message error">{error}</p> : null}
      <div className="result-summary" aria-live="polite">
        <strong>{total}</strong>
        <span>条结果</span>
        {loading ? (
          <Loader2 className="spin" size={15} aria-label="加载中" />
        ) : null}
      </div>

      {!loading && !results.length ? (
        <div className="catalog-empty">没有找到匹配的角色。</div>
      ) : view === "grid" ? (
        <div className="candidate-list page-candidates">
          {results.map((result) => (
            <article className="candidate static" key={result.id}>
              <CharacterAvatar
                avatarUrl={result.avatarUrl}
                name={result.name}
                initials={result.initials}
              />
              <span className="candidate-copy">
                <strong>{result.name}</strong>
                <small>{result.subtitle}</small>
              </span>
            </article>
          ))}
        </div>
      ) : (
        <div className="catalog-table-wrap">
          <table className="catalog-table">
            <thead>
              <tr>
                <th className="catalog-avatar-column">
                  <span className="sr-only">角色头像</span>
                </th>
                <th>名称</th>
                <th>初登场作品</th>
                <th>初登场年份</th>
                <th>种族</th>
                <th>地点</th>
                <th>阵营</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result) => (
                <tr key={result.id}>
                  <td>
                    <CharacterAvatar
                      avatarUrl={result.avatarUrl}
                      name={result.name}
                      initials={result.initials}
                      className="catalog-avatar"
                    />
                  </td>
                  <th scope="row">{result.name}</th>
                  <td>{result.firstAppearance.workTitle}</td>
                  <td>{result.firstAppearance.releaseYear}</td>
                  <td>{joinValues(result.species)}</td>
                  <td>{joinValues(result.locations)}</td>
                  <td>{joinValues(result.affiliations)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
