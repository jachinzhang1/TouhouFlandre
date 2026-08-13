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
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CharacterSort, SortDirection, Work } from "@touhouflandre/shared";
import { Paper } from "../../components/Paper";
import { PaperSearchInput } from "../../components/controls/PaperSearchInput";
import {
  PaperSegmentButton,
  PaperSegmentGroup,
  PaperSegmentSeparator,
} from "../../components/controls/PaperSegmentedControl";
import { CharacterAvatar } from "../../components/game/CharacterAvatar";
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
      className="pt-10 pb-8 max-[680px]:px-[18px] max-[680px]:pt-[28px] max-[680px]:pb-[18px]"
      aria-busy={loading}
    >
      <header className="text-center">
        <h1 className="mt-0 mb-0 font-brand text-[2.6rem] font-black leading-[1.15] max-[680px]:text-[2.05rem]">
          角色搜索
        </h1>
        <p className="mx-auto mt-3 mb-0 flex min-h-7 max-w-[720px] items-center justify-center text-center font-brand leading-[1.75] text-ink-soft">
          浏览当前题库中的可猜角色。
        </p>
      </header>

      <div className="catalog-querybar">
        <PaperSearchInput
          ariaLabel="搜索角色"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="输入关键词搜索：灵梦 / Reimu / 红白……"
          value={query}
        />
        <div className="catalog-controls" aria-label="角色目录显示设置">
          <PaperSegmentGroup label="显示方式">
            <PaperSegmentButton
              active={view === "grid"}
              ariaLabel="图标视图"
              onClick={() => setView("grid")}
              title="图标视图"
            >
              <LayoutGrid size={17} aria-hidden="true" />
            </PaperSegmentButton>
            <PaperSegmentSeparator />
            <PaperSegmentButton
              active={view === "list"}
              ariaLabel="列表视图"
              onClick={() => setView("list")}
              title="列表视图"
            >
              <List size={17} aria-hidden="true" />
            </PaperSegmentButton>
          </PaperSegmentGroup>
          <PaperSegmentGroup label="排序字段">
            <PaperSegmentButton
              active={sort === "appearance"}
              onClick={() => setSort("appearance")}
            >
              <ListOrdered size={17} aria-hidden="true" />
              <span>登场</span>
            </PaperSegmentButton>
            <PaperSegmentSeparator />
            <PaperSegmentButton
              active={sort === "name"}
              onClick={() => setSort("name")}
            >
              <ArrowDownAZ size={17} aria-hidden="true" />
              <span>名称</span>
            </PaperSegmentButton>
          </PaperSegmentGroup>
          <PaperSegmentGroup label="排序方向">
            <PaperSegmentButton
              active={direction === "asc"}
              ariaLabel="正序"
              onClick={() => setDirection("asc")}
              title="正序"
            >
              <ArrowUp size={17} aria-hidden="true" />
            </PaperSegmentButton>
            <PaperSegmentSeparator />
            <PaperSegmentButton
              active={direction === "desc"}
              ariaLabel="倒序"
              onClick={() => setDirection("desc")}
              title="倒序"
            >
              <ArrowDown size={17} aria-hidden="true" />
            </PaperSegmentButton>
          </PaperSegmentGroup>
        </div>
      </div>

      <Paper
        as="div"
        className="catalog-filter-paper mt-[12px]"
        folded={false}
        sticker={false}
        variant="plain"
      >
        <button
          type="button"
          className="catalog-filter-toggle"
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
          <div className="catalog-filter-content">
            <div className="flex flex-wrap gap-2">
              <Paper
                as="button"
                className="catalog-flat-button"
                disabled={works.length === 0}
                folded={false}
                onClick={() => setSelectedWorkIds(workIds)}
                sticker={false}
                variant="plain"
              >
                全选
              </Paper>
              <Paper
                as="button"
                className="catalog-flat-button"
                disabled={works.length === 0}
                folded={false}
                onClick={() => setSelectedWorkIds([])}
                sticker={false}
                variant="plain"
              >
                全不选
              </Paper>
            </div>
            <div className="mt-[12px] grid gap-2 max-[680px]:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
              {works.length > 0 ? (
                works.map((work) => (
                  <label key={work.id} className="catalog-work-option">
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
                      className="catalog-work-checkbox size-4 shrink-0"
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
                <div className="catalog-work-loading">正在读取作品列表。</div>
              )}
            </div>
          </div>
        ) : null}
      </Paper>

      {error ? (
        <div className="catalog-feedback" role="alert">
          <span>{error}</span>
          <Paper
            as="button"
            className="catalog-feedback-button"
            folded={false}
            onClick={retry}
            sticker={false}
            variant="plain"
          >
            重新加载
          </Paper>
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
          <span>正在加载题库</span>
        </div>
      ) : error ? null : !results.length ? (
        <Paper
          animateOnMount={false}
          as="div"
          className="catalog-empty-result grid min-h-[180px] place-items-center text-ink-soft"
          foldSize={16}
        >
          没有找到匹配的角色。
        </Paper>
      ) : view === "grid" ? (
        <div className="catalog-result-grid">
          {results.map((result, index) => (
            <Paper
              animateOnMount={false}
              as="article"
              className="catalog-result-card"
              foldSize={14}
              key={result.id}
              stackOrder={results.length - index}
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
            </Paper>
          ))}
        </div>
      ) : (
        <Paper
          animateOnMount={false}
          as="div"
          className="catalog-results-table mt-[10px] overflow-x-auto"
          foldSize={16}
        >
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
        </Paper>
      )}
    </section>
  );
}
