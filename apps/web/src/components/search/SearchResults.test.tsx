import { fireEvent, render, screen } from "@testing-library/react";
import type { CharacterSearchResult } from "@touhouflandre/shared";
import { describe, expect, it } from "vitest";
import { SearchResults } from "./SearchResults";

const result: CharacterSearchResult = {
  id: "reimu_hakurei",
  name: "博丽灵梦",
  subtitle: "Reimu Hakurei · 东方红魔乡",
  initials: "博丽",
  avatarUrl: "",
  appearanceOrder: 1,
  workId: "th06_eosd",
  searchText: "reimu",
  nameSortKey: "reimu",
  firstAppearance: { workTitle: "东方红魔乡", releaseYear: 2002 },
  species: ["人类"],
  locations: ["博丽神社"],
  affiliations: ["博丽神社"],
  hairColors: ["black"],
};

describe("SearchResults", () => {
  it("separates list controls from the sticky result summary and table header", () => {
    const { container } = render(
      <SearchResults
        controls={<div data-testid="controls">搜索控制</div>}
        error=""
        loading={false}
        onRetry={() => undefined}
        results={[result]}
        total={1}
        view="list"
      />,
    );

    const controlsSticky = container.querySelector(".catalog-controls-sticky");
    const summarySticky = container.querySelector(".catalog-summary-sticky");
    const tableHeader = screen.getByRole("table", { name: "角色目录表头" });
    expect(controlsSticky?.contains(screen.getByTestId("controls"))).toBe(true);
    expect(controlsSticky?.contains(tableHeader)).toBe(false);
    expect(summarySticky?.contains(tableHeader)).toBe(true);
    expect(container.querySelector(".catalog-summary-sticky-gap")).toBeTruthy();

    const tableSurface = container.querySelector(
      ".catalog-results-table",
    ) as HTMLElement;
    expect(tableSurface.classList.contains("paper-data-table")).toBe(true);
    expect(tableSurface.dataset.paperFolded).toBe("false");
    expect(tableSurface.closest(".paper-sticker")).toBeNull();
    expect(screen.getByRole("table", { name: "角色目录结果" })).toBeTruthy();
  });

  it("synchronizes horizontal scrolling between the header and table body", () => {
    const { container } = render(
      <SearchResults
        controls={<div>搜索控制</div>}
        error=""
        loading={false}
        onRetry={() => undefined}
        results={[result]}
        total={1}
        view="list"
      />,
    );

    const body = container.querySelector(
      ".catalog-table-body-scroll",
    ) as HTMLDivElement;
    const header = container.querySelector(
      ".catalog-table-header-scroll",
    ) as HTMLDivElement;
    body.scrollLeft = 180;
    fireEvent.scroll(body);
    expect(header.scrollLeft).toBe(180);
  });

  it("separates grid controls from the sticky result count", () => {
    const { container } = render(
      <SearchResults
        controls={<div data-testid="controls">搜索控制</div>}
        error=""
        loading={false}
        onRetry={() => undefined}
        results={[result]}
        total={1}
        view="grid"
      />,
    );

    const controlsSticky = container.querySelector(".catalog-controls-sticky");
    const summarySticky = container.querySelector(".catalog-summary-sticky");
    expect(controlsSticky?.contains(screen.getByTestId("controls"))).toBe(true);
    expect(summarySticky?.textContent).toContain("1条结果");
    expect(controlsSticky?.textContent).not.toContain("1条结果");
    expect(container.querySelector(".catalog-table-header-scroll")).toBeNull();
    expect(container.querySelectorAll(".catalog-result-card")).toHaveLength(1);
  });
});
