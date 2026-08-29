"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowDownAZ,
  ChevronDown,
  ChevronUp,
  Filter,
  LayoutGrid,
  List,
  ListOrdered,
  Loader2,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CharacterSort, SortDirection, Work } from "@touhouflandre/shared";
import { CharacterAvatar } from "../../components/CharacterAvatar";
import { useCatalogSummary } from "../../hooks/useCatalogSummary";
import { useCharacterSearch } from "../../hooks/useCharacterSearch";
import { joinValues } from "../../domain/format";

type CharacterView = "grid" | "list";

const initialParams =
  typeof window === "undefined"
    ? new URLSearchParams()
    : new URLSearchParams(window.location.search);
const initialView: CharacterView =
  initialParams.get("view") === "list" ? "list" : "grid";
const initialSort: CharacterSort =
  initialParams.get("sort") === "name" ? "name" : "appearance";
const initialDirection: SortDirection =
  initialParams.get("direction") === "desc" ? "desc" : "asc";

const compareWorks = (left: Work, right: Work) =>
  left.releaseYear - right.releaseYear ||
  (left.mainlineIndex ?? Number.MAX_SAFE_INTEGER) -
    (right.mainlineIndex ?? Number.MAX_SAFE_INTEGER) ||
  left.shortName.localeCompare(right.shortName) ||
  left.id.localeCompare(right.id);

export default function SearchPage() {
  const catalog = useCatalogSummary();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<CharacterView>(initialView);
  const [sort, setSort] = useState<CharacterSort>(initialSort);
  const [direction, setDirection] = useState<SortDirection>(initialDirection);
  const [filterExpanded, setFilterExpanded] = useState(false);
  const [selectedWorkIds, setSelectedWorkIds] = useState<string[]>([]);
  const initializedWorkFilterRef = useRef(false);
  const works = useMemo(
    () => [...(catalog?.works ?? [])].sort(compareWorks),
    [catalog?.works],
  );
  const workIds = useMemo(() => works.map((work) => work.id), [works]);
  const selectedWorkIdSet = useMemo(
    () => new Set(selectedWorkIds),
    [selectedWorkIds],
  );

  useEffect(() => {
    if (initializedWorkFilterRef.current || workIds.length === 0) return;
    initializedWorkFilterRef.current = true;
    setSelectedWorkIds(workIds);
  }, [workIds]);

  const selectedWorkIdsParam = initializedWorkFilterRef.current
    ? selectedWorkIds.join(",")
    : undefined;

  const { error, loading, results, retry, total } = useCharacterSearch(query, {
    limit: 250,
    version: catalog?.version,
    sort,
    direction,
    workIds: selectedWorkIdsParam,
  });

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
    <section
      className="px-[18px] pt-12 pb-6 max-[680px]:pt-[34px] max-[680px]:pb-[18px]"
      aria-busy={loading}
    >
      <div className="max-w-[720px]">
        <p className="mt-0 mb-2 text-[0.69rem] font-black tracking-[0.12em] text-vermilion">
          ARCHIVE
        </p>
        <h1 className="mt-0 mb-0 font-brand text-[2.6rem] font-bold leading-[1.15] max-[680px]:text-[2.05rem]">
          角色搜索
        </h1>
        <p className="mt-3 mb-0 leading-[1.75] text-ink-soft">
          浏览当前题库中的可猜角色。
        </p>
      </div>

      <div className="mt-[26px] flex items-center justify-between gap-3 max-[680px]:mt-0 max-[680px]:grid max-[680px]:gap-[9px]">
        <label className="catalog-search-box flex min-h-[48px] min-w-0 flex-1 items-center gap-[11px] rounded-[4px] border border-line-strong bg-[var(--surface)] px-[14px] text-[var(--muted-text)] transition-[border-color,box-shadow] duration-150 focus-within:border-jade focus-within:text-jade focus-within:shadow-[0_0_0_4px_var(--jade-focus-soft)] max-[680px]:mt-[26px]">
          <Search size={18} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="例如 灵梦 / Reimu / 红白"
            aria-label="搜索角色"
            className="catalog-search-input w-full min-w-0 border-0 bg-transparent text-ink placeholder:text-[var(--placeholder-text)]"
          />
        </label>
        <div className="catalog-controls" aria-label="角色目录显示设置">
          <div className="catalog-segment" role="group" aria-label="显示方式">
            <button
              className={`catalog-segment-button${view === "grid" ? " active" : ""}`}
              type="button"
              onClick={() => setView("grid")}
              title="图标视图"
              aria-label="图标视图"
              aria-pressed={view === "grid"}
            >
              <LayoutGrid size={17} aria-hidden="true" />
            </button>
            <button
              className={`catalog-segment-button${view === "list" ? " active" : ""}`}
              type="button"
              onClick={() => setView("list")}
              title="列表视图"
              aria-label="列表视图"
              aria-pressed={view === "list"}
            >
              <List size={17} aria-hidden="true" />
            </button>
          </div>
          <div className="catalog-segment" role="group" aria-label="排序字段">
            <button
              className={`catalog-segment-button${sort === "appearance" ? " active" : ""}`}
              type="button"
              onClick={() => setSort("appearance")}
              aria-pressed={sort === "appearance"}
            >
              <ListOrdered size={17} aria-hidden="true" />
              <span>登场</span>
            </button>
            <button
              className={`catalog-segment-button${sort === "name" ? " active" : ""}`}
              type="button"
              onClick={() => setSort("name")}
              aria-pressed={sort === "name"}
            >
              <ArrowDownAZ size={17} aria-hidden="true" />
              <span>名称</span>
            </button>
          </div>
          <div className="catalog-segment" role="group" aria-label="排序方向">
            <button
              className={`catalog-segment-button${direction === "asc" ? " active" : ""}`}
              type="button"
              onClick={() => setDirection("asc")}
              title="正序"
              aria-label="正序"
              aria-pressed={direction === "asc"}
            >
              <ArrowUp size={17} aria-hidden="true" />
            </button>
            <button
              className={`catalog-segment-button${direction === "desc" ? " active" : ""}`}
              type="button"
              onClick={() => setDirection("desc")}
              title="倒序"
              aria-label="倒序"
              aria-pressed={direction === "desc"}
            >
              <ArrowDown size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <div className="mt-[12px] rounded-[4px] border border-line bg-paper">
        <button
          type="button"
          className="flex min-h-[50px] w-full items-center justify-between gap-3 px-[14px] text-left"
          onClick={() => setFilterExpanded((current) => !current)}
          aria-expanded={filterExpanded}
        >
          <span className="flex min-w-0 items-center gap-2 text-[0.78rem] font-extrabold text-ink">
            <Filter size={16} aria-hidden="true" />
            <span>作品筛选</span>
          </span>
          <span className="flex items-center gap-2 text-[0.76rem] font-bold text-ink-soft">
            <span>
              {works.length > 0
                ? `${selectedWorkIds.length}/${works.length}`
                : "加载中"}
            </span>
            {filterExpanded ? (
              <ChevronUp size={16} aria-hidden="true" />
            ) : (
              <ChevronDown size={16} aria-hidden="true" />
            )}
          </span>
        </button>
        {filterExpanded ? (
          <div className="border-t border-line px-[14px] py-[14px]">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex min-h-[34px] items-center rounded-[4px] border border-line-strong bg-[var(--surface)] px-3 text-[0.76rem] font-extrabold text-ink transition-[border-color,background] duration-150 hover:border-[var(--control-border-hover)] hover:bg-[var(--surface-hover)]"
                onClick={() => setSelectedWorkIds(workIds)}
                disabled={workIds.length === 0}
              >
                全选
              </button>
              <button
                type="button"
                className="inline-flex min-h-[34px] items-center rounded-[4px] border border-line-strong bg-[var(--surface)] px-3 text-[0.76rem] font-extrabold text-ink transition-[border-color,background] duration-150 hover:border-[var(--control-border-hover)] hover:bg-[var(--surface-hover)]"
                onClick={() => setSelectedWorkIds([])}
                disabled={workIds.length === 0}
              >
                全不选
              </button>
            </div>
            <div className="mt-[12px] grid gap-2 max-[680px]:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
              {works.length > 0 ? (
                works.map((work) => (
                  <label
                    key={work.id}
                    className="flex min-h-[48px] items-center gap-3 rounded-[4px] border border-line bg-[var(--surface)] px-[12px] py-[10px] text-[0.84rem] text-ink"
                  >
                    <input
                      type="checkbox"
                      checked={selectedWorkIdSet.has(work.id)}
                      onChange={() => {
                        setSelectedWorkIds((current) =>
                          current.includes(work.id)
                            ? current.filter((id) => id !== work.id)
                            : [...current, work.id],
                        );
                      }}
                      className="size-4 shrink-0 accent-jade"
                    />
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate font-bold">
                        {work.titleZh}
                      </strong>
                      <span className="mt-1 block text-[0.74rem] text-ink-soft">
                        {work.shortName} · {work.releaseYear}
                      </span>
                    </span>
                  </label>
                ))
              ) : (
                <div className="rounded-[4px] border border-dashed border-line bg-[var(--surface)] px-[12px] py-[14px] text-[0.82rem] text-ink-soft">
                  正在读取作品列表。
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="catalog-feedback" role="alert">
          <span>{error}</span>
          <button type="button" onClick={retry}>
            重新加载
          </button>
        </div>
      ) : null}
      <div
        className="mt-[30px] flex items-baseline gap-[5px] text-[0.76rem] text-ink-soft"
        aria-live="polite"
      >
        <strong className="font-[Georgia,serif] text-[1.4rem] text-ink">
          {total}
        </strong>
        <span>条结果</span>
        {loading ? (
          <Loader2 className="spin" size={15} aria-label="加载中" />
        ) : null}
      </div>

      {loading ? (
        <div className="catalog-state" role="status">
          <Loader2 className="spin" size={20} aria-hidden="true" />
          <span>正在加载搜索索引</span>
        </div>
      ) : error ? null : !results.length ? (
        <div className="mt-[10px] grid min-h-[180px] place-items-center rounded-[4px] border border-line bg-paper text-ink-soft">
          没有找到匹配的角色。
        </div>
      ) : view === "grid" ? (
        <div className="mt-[10px] grid grid-cols-[repeat(auto-fit,minmax(255px,1fr))] gap-[9px]">
          {results.map((result) => (
            <article
              className="grid min-h-[64px] cursor-default grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-[11px] rounded-[4px] border border-line bg-paper p-[10px] text-ink transition-[border-color,background] duration-150 hover:border-[var(--accent-hover-border)] hover:bg-[var(--surface-hover)]"
              key={result.id}
            >
              <CharacterAvatar
                avatarUrl={result.avatarUrl}
                name={result.name}
                initials={result.initials}
              />
              <span className="min-w-0">
                <strong className="block truncate">{result.name}</strong>
                <small className="mt-1 block truncate text-[0.76rem] text-ink-soft">
                  {result.subtitle}
                </small>
              </span>
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-[10px] overflow-x-auto rounded-[6px] border border-line bg-paper shadow-sm">
          <table className="w-full min-w-[980px] border-collapse text-left">
            <thead>
              <tr>
                <th className="h-11 w-[62px] px-[13px] py-[11px] text-[0.72rem] font-bold text-ink-soft">
                  <span className="sr-only">角色头像</span>
                </th>
                <th className="h-11 px-[13px] py-[11px] text-[0.72rem] font-bold text-ink-soft">
                  名称
                </th>
                <th className="h-11 px-[13px] py-[11px] text-[0.72rem] font-bold text-ink-soft">
                  初登场作品
                </th>
                <th className="h-11 px-[13px] py-[11px] text-[0.72rem] font-bold text-ink-soft">
                  初登场年份
                </th>
                <th className="h-11 px-[13px] py-[11px] text-[0.72rem] font-bold text-ink-soft">
                  种族
                </th>
                <th className="h-11 px-[13px] py-[11px] text-[0.72rem] font-bold text-ink-soft">
                  地点
                </th>
                <th className="h-11 px-[13px] py-[11px] text-[0.72rem] font-bold text-ink-soft">
                  阵营
                </th>
              </tr>
            </thead>
            <tbody>
              {results.map((result) => (
                <tr key={result.id} className="hover:bg-[var(--surface-hover)]">
                  <td className="border-b border-line px-[13px] py-[11px]">
                    <CharacterAvatar
                      avatarUrl={result.avatarUrl}
                      name={result.name}
                      initials={result.initials}
                      className="catalog-avatar"
                    />
                  </td>
                  <th
                    scope="row"
                    className="whitespace-nowrap border-b border-line px-[13px] py-[11px] text-[0.86rem]"
                  >
                    {result.name}
                  </th>
                  <td className="border-b border-line px-[13px] py-[11px]">
                    {result.firstAppearance.workTitle}
                  </td>
                  <td className="border-b border-line px-[13px] py-[11px]">
                    {result.firstAppearance.releaseYear}
                  </td>
                  <td className="border-b border-line px-[13px] py-[11px]">
                    {joinValues(result.species)}
                  </td>
                  <td className="border-b border-line px-[13px] py-[11px]">
                    {joinValues(result.locations)}
                  </td>
                  <td className="border-b border-line px-[13px] py-[11px]">
                    {joinValues(result.affiliations)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
