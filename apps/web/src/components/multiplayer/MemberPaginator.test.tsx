import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemberPaginator } from "./MemberPaginator";

const items = Array.from({ length: 5 }, (_, index) => ({
  memberId: `member-${index + 1}`,
  seat: index + 1,
}));

describe("MemberPaginator", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
  });

  it("uses shared Paper pagination and mounts only the current page", () => {
    render(
      <MemberPaginator
        items={items}
        label="boards"
        renderItem={(item) => <span>{item.memberId}</span>}
      />,
    );
    expect(screen.getAllByText(/member-/)).toHaveLength(2);
    const pager = screen.getByRole("group", { name: "boards翻页" });
    expect(pager.classList.contains("paper-pagination")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "boards下一页" }));
    expect(screen.getByText("2 / 3")).toBeTruthy();
    expect(
      screen.getAllByText(/member-/).map((node) => node.textContent),
    ).toEqual(["member-3", "member-4"]);
    fireEvent.click(screen.getByRole("button", { name: "boards下一页" }));
    expect(screen.getByText("3 / 3")).toBeTruthy();
    expect(
      screen.getAllByText(/member-/).map((node) => node.textContent),
    ).toEqual(["member-5"]);
  });

  it("mounts one board on a mobile viewport", () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);
    render(
      <MemberPaginator
        items={items}
        label="boards"
        renderItem={(item) => <span>{item.memberId}</span>}
      />,
    );
    expect(screen.getAllByText(/member-/)).toHaveLength(1);
  });

  it("honors a fixed single-board page on desktop", () => {
    render(
      <MemberPaginator
        items={items}
        label="对手棋盘"
        pageSize={1}
        renderItem={(item) => <span>{item.memberId}</span>}
      />,
    );
    expect(screen.getAllByText(/member-/)).toHaveLength(1);
    expect(
      screen
        .getByText(/member-/)
        .closest("[data-page-size]")
        ?.getAttribute("data-page-size"),
    ).toBe("1");
  });

  it("embeds contextual page controls in a caller-provided header", () => {
    render(
      <MemberPaginator
        getPageLabel={({ page, pageCount, visibleItems }) =>
          `P${visibleItems[0]?.seat} · ${page} / ${pageCount}`
        }
        items={items}
        label="boards"
        pageSize={1}
        renderHeader={({ controls, visibleItems }) => (
          <header>
            <strong>{`P${visibleItems[0]?.seat}`}</strong>
            {controls}
          </header>
        )}
        renderItem={(item) => <span>{item.memberId}</span>}
      />,
    );

    expect(screen.getByText("P1 · 1 / 5")).toBeTruthy();
    const next = screen.getByRole("button", { name: "boards下一页" });
    const controlsId = next.getAttribute("aria-controls");
    expect(controlsId).toBeTruthy();
    expect(document.getElementById(controlsId!)).toBeTruthy();
    fireEvent.click(next);
    expect(screen.getByText("P2 · 2 / 5")).toBeTruthy();
  });
});
