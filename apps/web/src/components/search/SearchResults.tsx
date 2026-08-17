import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import type { CharacterSearchResult } from "@touhouflandre/shared";
import { joinValues } from "../../domain/format";
import {
  Paper,
  PaperButton,
  PaperDataTable,
  PaperDataTableBody,
  PaperDataTableHeader,
} from "@/components/paper";
import { CharacterAvatar } from "../game/CharacterAvatar";
import type { CharacterView } from "./types";

export function SearchResults({
  controls,
  error,
  loading,
  onRetry,
  results,
  total,
  view,
}: {
  controls: ReactNode;
  error: string;
  loading: boolean;
  onRetry: () => void;
  results: CharacterSearchResult[];
  total: number;
  view: CharacterView;
}) {
  return (
    <SearchResultsLayout
      controls={controls}
      error={error}
      loading={loading}
      onRetry={onRetry}
      results={results}
      total={total}
      view={view}
    />
  );
}

function SearchResultsLayout({
  controls,
  error,
  loading,
  onRetry,
  results,
  total,
  view,
}: {
  controls: ReactNode;
  error: string;
  loading: boolean;
  onRetry: () => void;
  results: CharacterSearchResult[];
  total: number;
  view: CharacterView;
}) {
  const layoutRef = useRef<HTMLDivElement>(null);
  const controlsStickyRef = useRef<HTMLDivElement>(null);
  const summaryStickyRef = useRef<HTMLDivElement>(null);
  const { controlsStuck, summaryStuck } = useSplitStickyState(
    layoutRef,
    controlsStickyRef,
    summaryStickyRef,
  );

  const showTable = view === "list" && !loading && !error && results.length > 0;

  return (
    <PaperDataTable>
      <div
        className="catalog-results-layout"
        data-controls-stuck={controlsStuck ? "true" : "false"}
        data-summary-stuck={summaryStuck ? "true" : "false"}
        data-view={view}
        ref={layoutRef}
      >
        <div className="catalog-controls-sticky" ref={controlsStickyRef}>
          {controls}
        </div>
        <div className="catalog-summary-sticky-gap" aria-hidden="true" />
        <div className="catalog-summary-sticky" ref={summaryStickyRef}>
          <SearchError error={error} onRetry={onRetry} />
          <SearchResultCount loading={loading} total={total} />
          <SearchTableHeaderSlot visible={showTable} />
        </div>
        <SearchResultContent
          error={error}
          loading={loading}
          results={results}
          view={view}
        />
      </div>
    </PaperDataTable>
  );
}

function SearchResultContent({
  error,
  loading,
  results,
  view,
}: {
  error: string;
  loading: boolean;
  results: CharacterSearchResult[];
  view: CharacterView;
}) {
  if (view === "grid") {
    return (
      <SearchGridResultBody error={error} loading={loading} results={results} />
    );
  }

  return (
    <SearchListResultBody error={error} loading={loading} results={results} />
  );
}

function useSplitStickyState(
  layoutRef: React.RefObject<HTMLDivElement | null>,
  controlsRef: React.RefObject<HTMLDivElement | null>,
  summaryRef: React.RefObject<HTMLDivElement | null>,
) {
  const [state, setState] = useState({
    controlsStuck: false,
    summaryStuck: false,
  });

  useEffect(() => {
    let animationFrame = 0;
    const layout = layoutRef.current;
    const controls = controlsRef.current;
    const summary = summaryRef.current;
    if (!layout || !controls || !summary) return;

    const isStuck = (element: HTMLElement) => {
      const stickyTop = Number.parseFloat(getComputedStyle(element).top);
      return (
        Number.isFinite(stickyTop) &&
        window.scrollY > 0 &&
        element.getBoundingClientRect().top <= stickyTop + 0.5
      );
    };

    const update = () => {
      animationFrame = 0;
      layout.style.setProperty(
        "--catalog-controls-sticky-height",
        `${controls.getBoundingClientRect().height}px`,
      );
      const next = {
        controlsStuck: isStuck(controls),
        summaryStuck: isStuck(summary),
      };
      setState((current) =>
        current.controlsStuck === next.controlsStuck &&
        current.summaryStuck === next.summaryStuck
          ? current
          : next,
      );
    };

    const scheduleUpdate = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(update);
    };

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleUpdate);
    resizeObserver?.observe(controls);
    resizeObserver?.observe(summary);
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    update();

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      layout.style.removeProperty("--catalog-controls-sticky-height");
    };
  }, [controlsRef, layoutRef, summaryRef]);

  return state;
}

function SearchError({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  if (!error) return null;

  return (
    <Paper
      animateOnMount={false}
      as="div"
      className="catalog-feedback"
      folded={false}
      pattern={false}
      role="alert"
      sticker={false}
      tone="danger"
      unfoldOnHover={false}
    >
      <span>{error}</span>
      <PaperButton compact folded={false} onClick={onRetry} tone="danger">
        重新加载
      </PaperButton>
    </Paper>
  );
}

function SearchResultCount({
  loading,
  total,
}: {
  loading: boolean;
  total: number;
}) {
  return (
    <div className="catalog-result-count" aria-live="polite">
      <strong>{total}</strong>
      <span>条结果</span>
      <SearchResultCountLoader loading={loading} />
    </div>
  );
}

function SearchResultCountLoader({ loading }: { loading: boolean }) {
  if (!loading) return null;
  return <Loader2 className="spin" size={15} aria-label="加载中" />;
}

function SearchGridResultBody({
  error,
  loading,
  results,
}: {
  error: string;
  loading: boolean;
  results: CharacterSearchResult[];
}) {
  if (loading) return <SearchLoadingState />;
  if (error) return null;
  if (results.length === 0) return <SearchEmptyState />;
  return <SearchResultGrid results={results} />;
}

function SearchListResultBody({
  error,
  loading,
  results,
}: {
  error: string;
  loading: boolean;
  results: CharacterSearchResult[];
}) {
  if (loading) return <SearchLoadingState />;
  if (error) return null;
  if (results.length === 0) return <SearchEmptyState />;
  return <SearchResultTable results={results} />;
}

function SearchLoadingState() {
  return (
    <div className="catalog-state" role="status">
      <Loader2 className="spin" size={20} aria-hidden="true" />
      <span>正在加载题库</span>
    </div>
  );
}

function SearchEmptyState() {
  return (
    <Paper
      animateOnMount={false}
      as="div"
      className="catalog-empty-result grid min-h-[180px] place-items-center"
      foldSize={16}
      unfoldOnHover={false}
    >
      没有找到匹配的角色。
    </Paper>
  );
}

function SearchResultGrid({ results }: { results: CharacterSearchResult[] }) {
  return (
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
  );
}

function SearchTableHeaderSlot({ visible }: { visible: boolean }) {
  return (
    <PaperDataTableHeader
      className="catalog-table-header-scroll"
      visible={visible}
    >
      <table className="catalog-table" aria-label="角色目录表头">
        <SearchTableColumns />
        <thead className="catalog-table-header paper-data-table-header">
          <SearchTableHeaderRow />
        </thead>
      </table>
    </PaperDataTableHeader>
  );
}

function SearchResultTable({ results }: { results: CharacterSearchResult[] }) {
  return (
    <PaperDataTableBody
      className="catalog-results-table"
      viewportClassName="catalog-table-body-scroll"
    >
      <table className="catalog-table" aria-label="角色目录结果">
        <SearchTableColumns />
        <tbody className="paper-data-table-body">
          {results.map((result) => (
            <tr className="paper-data-table-row" key={result.id}>
              <td headers="catalog-column-avatar">
                <CharacterAvatar
                  avatarUrl={result.avatarUrl}
                  name={result.name}
                  initials={result.initials}
                  className="catalog-avatar"
                />
              </td>
              <th
                headers="catalog-column-name"
                scope="row"
                className="catalog-table-name"
                title={result.name}
              >
                {result.name}
              </th>
              <td headers="catalog-column-work">
                {result.firstAppearance.workTitle}
              </td>
              <td headers="catalog-column-year">
                {result.firstAppearance.releaseYear}
              </td>
              <td headers="catalog-column-species">
                {joinValues(result.species)}
              </td>
              <td headers="catalog-column-location">
                {joinValues(result.locations)}
              </td>
              <td headers="catalog-column-affiliation">
                {joinValues(result.affiliations)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </PaperDataTableBody>
  );
}

function SearchTableColumns() {
  return (
    <colgroup>
      <col className="catalog-column-avatar" />
      <col className="catalog-column-name" />
      <col className="catalog-column-work" />
      <col className="catalog-column-year" />
      <col className="catalog-column-species" />
      <col className="catalog-column-location" />
      <col className="catalog-column-affiliation" />
    </colgroup>
  );
}

function SearchTableHeaderRow() {
  return (
    <tr className="paper-data-table-row">
      <th id="catalog-column-avatar">
        <span className="sr-only">角色头像</span>
      </th>
      <th id="catalog-column-name">名称</th>
      <th id="catalog-column-work">初登场作品</th>
      <th id="catalog-column-year">初登场年份</th>
      <th id="catalog-column-species">种族</th>
      <th id="catalog-column-location">地点</th>
      <th id="catalog-column-affiliation">阵营</th>
    </tr>
  );
}
