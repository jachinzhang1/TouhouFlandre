import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SearchPage from "./page";

const catalogMock = vi.hoisted(() => vi.fn());
const searchMock = vi.hoisted(() =>
  vi.fn(() => ({
    error: "",
    loading: false,
    results: [],
    retry: vi.fn(),
    total: 0,
  })),
);

vi.mock("../../hooks/useCatalogSummary", () => ({
  useCatalogSummary: catalogMock,
}));
vi.mock("../../hooks/useCharacterSearch", () => ({
  useCharacterSearch: searchMock,
}));

describe("SearchPage", () => {
  beforeEach(() => {
    catalogMock.mockReset();
    searchMock.mockClear();
    catalogMock.mockReturnValue({
      version: "catalog-v1",
      dailyDateKey: "2026-08-05",
      contents: [],
      works: [],
    });
  });

  it("binds catalog search to the summary version", () => {
    render(<SearchPage />);

    expect(searchMock).toHaveBeenCalledWith(
      "",
      expect.objectContaining({
        version: "catalog-v1",
        limit: 250,
        sort: "appearance",
        direction: "asc",
      }),
    );
  });

  it("does not claim an unknown index version", () => {
    catalogMock.mockReturnValue({
      dailyDateKey: "2026-08-05",
      contents: [],
      works: [],
    });
    searchMock.mockReturnValue({
      error: "",
      loading: true,
      results: [],
      retry: vi.fn(),
      total: 0,
    });

    render(<SearchPage />);

    expect(searchMock).toHaveBeenCalledWith(
      "",
      expect.objectContaining({ version: undefined }),
    );
    expect(screen.getByText("正在加载搜索索引")).toBeTruthy();
  });
});
