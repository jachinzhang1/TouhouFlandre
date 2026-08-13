import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { HomePage } from "./HomePage";

const catalogSummary = {
  dailyDateKey: "2026-08-05",
  contents: [
    {
      contentType: "character",
      label: "东方角色",
      total: 29,
      guessable: 29,
      answerable: 29,
      maxGuesses: 8,
      visibleFieldCount: 6,
    },
  ],
  works: [],
};

vi.mock("../../lib/api", () => ({
  api: {
    catalog: vi.fn(),
  },
}));

import { api } from "../../lib/api";

describe("HomePage", () => {
  beforeEach(() => {
    vi.mocked(api.catalog).mockReset();
  });

  it("renders catalog guessable count from API", async () => {
    vi.mocked(api.catalog).mockResolvedValue(catalogSummary as never);
    render(<HomePage />);
    expect(await screen.findByText("29")).toBeTruthy();
    expect(screen.getByRole("link", { name: /每日题/ })).toBeTruthy();
    expect(screen.queryByText("开始每日题")).toBeNull();
  });

  it("falls back to placeholder when catalog request fails", async () => {
    vi.mocked(api.catalog).mockRejectedValue(new Error("down"));
    render(<HomePage />);
    expect(await screen.findByText("-")).toBeTruthy();
  });
});
