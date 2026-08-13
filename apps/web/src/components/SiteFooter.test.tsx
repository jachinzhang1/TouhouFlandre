import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SiteFooter, resetSiteVisitForTest } from "./SiteFooter";

const { recordSiteVisitMock } = vi.hoisted(() => ({
  recordSiteVisitMock: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  api: {
    recordSiteVisit: recordSiteVisitMock,
  },
}));

describe("SiteFooter", () => {
  beforeEach(() => {
    recordSiteVisitMock.mockReset();
    resetSiteVisitForTest();
  });

  it("显示访问数占位并在记录成功后展示格式化数字", async () => {
    recordSiteVisitMock.mockResolvedValue({ count: 12345 });

    const { container } = render(<SiteFooter />);

    expect(screen.getByText(/访问数 --/)).toBeTruthy();
    expect(await screen.findByText(/访问数 12,345/)).toBeTruthy();
    expect(recordSiteVisitMock).toHaveBeenCalledOnce();
    const separators = Array.from(
      container.querySelectorAll<SVGElement>(".footer-yin-yang"),
    );
    expect(separators).toHaveLength(2);
    const maskIds = separators.map(
      (separator) => separator.querySelector("mask")?.id,
    );
    expect(new Set(maskIds).size).toBe(2);
    for (const [index, separator] of separators.entries()) {
      expect(
        separator.querySelector("circle[mask]")?.getAttribute("mask"),
      ).toBe(`url(#${maskIds[index]})`);
    }
    expect(container.textContent).not.toContain(" · ");
  });

  it("重复渲染时只记录一次访问", async () => {
    recordSiteVisitMock.mockResolvedValue({ count: 8 });
    const { rerender } = render(<SiteFooter />);

    rerender(<SiteFooter />);

    await waitFor(() => expect(recordSiteVisitMock).toHaveBeenCalledOnce());
    expect(await screen.findByText(/访问数 8/)).toBeTruthy();
  });

  it("记录失败时保留占位文案", async () => {
    recordSiteVisitMock.mockRejectedValue(new Error("down"));

    render(<SiteFooter />);

    await waitFor(() => expect(recordSiteVisitMock).toHaveBeenCalledOnce());
    expect(screen.getByText(/访问数 --/)).toBeTruthy();
  });
});
