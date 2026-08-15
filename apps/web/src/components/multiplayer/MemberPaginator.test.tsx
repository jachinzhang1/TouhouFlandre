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

  it("mounts only the current desktop page", () => {
    render(
      <MemberPaginator
        items={items}
        label="boards"
        renderItem={(item) => <span>{item.memberId}</span>}
      />,
    );
    expect(screen.getAllByText(/member-/)).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "boards下一页" }));
    expect(
      screen.getAllByText(/member-/).map((node) => node.textContent),
    ).toEqual(["member-3", "member-4"]);
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
});
