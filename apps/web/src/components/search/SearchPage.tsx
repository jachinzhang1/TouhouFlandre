"use client";

import type { CharacterSort, SortDirection } from "@touhouflandre/shared";
import type { CharacterView } from "./types";
import { useCharacterSearch } from "../../hooks/useCharacterSearch";
import { PageHeader } from "../layout/PageHeader";
import { SearchResults } from "./SearchResults";
import { SearchToolbar } from "./SearchToolbar";
import { useSearchPageState } from "./useSearchPageState";
import { WorkFilter } from "./WorkFilter";

export function SearchPage({
  initialDirection,
  initialSort,
  initialView,
}: {
  initialDirection: SortDirection;
  initialSort: CharacterSort;
  initialView: CharacterView;
}) {
  const state = useSearchPageState({
    initialDirection,
    initialSort,
    initialView,
  });
  const search = useCharacterSearch(state.query, {
    limit: 250,
    sort: state.sort,
    direction: state.direction,
    workIds: state.selectedWorkIdsParam,
  });

  return (
    <section
      className="pt-10 pb-8 max-[680px]:px-[18px] max-[680px]:pt-[28px] max-[680px]:pb-[18px]"
      aria-busy={search.loading}
    >
      <PageHeader description="浏览当前题库中的可猜角色。" title="角色搜索" />
      <SearchResults
        controls={
          <>
            <SearchToolbar
              direction={state.direction}
              onDirectionChange={state.setDirection}
              onQueryChange={state.setQuery}
              onSortChange={state.setSort}
              onViewChange={state.setView}
              query={state.query}
              sort={state.sort}
              view={state.view}
            />
            <WorkFilter
              mode={state.workFilterMode}
              onModeChange={state.setWorkFilterMode}
              onSelectedWorkIdsChange={state.setSelectedWorkIds}
              selectedWorkIds={state.selectedWorkIds}
              works={state.works}
            />
          </>
        }
        error={search.error}
        loading={search.loading}
        onRetry={search.retry}
        results={search.results}
        total={search.total}
        view={state.view}
      />
    </section>
  );
}
