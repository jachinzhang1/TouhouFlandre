import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageBackLink, PageHeader, PageHeaderAction } from "./PageHeader";

describe("PageHeader", () => {
  it("supports optional floating slots around the title", () => {
    const { container } = render(
      <PageHeader
        description="页面说明"
        leftSlot={<PageBackLink href="/single">返回游戏</PageBackLink>}
        rightSlot={
          <PageHeaderAction
            ariaLabel="页面操作"
            onClick={() => undefined}
            tone="danger"
          >
            页面操作
          </PageHeaderAction>
        }
        title="嵌套页面"
      />,
    );

    expect(screen.getByRole("heading", { name: "嵌套页面" })).toBeTruthy();
    const back = screen.getByRole("link", { name: "返回游戏" });
    expect(back.getAttribute("href")).toBe("/single");
    expect(
      back.querySelector(".lucide-chevron-left")?.getAttribute("width"),
    ).toBe("20");
    expect(
      container.querySelector(".page-header-slot-left")?.contains(back),
    ).toBe(true);
    expect(
      container
        .querySelector(".page-header-slot-right")
        ?.contains(screen.getByRole("button", { name: "页面操作" })),
    ).toBe(true);
    const action = screen.getByRole("button", { name: "页面操作" });
    expect(action.className).toContain("page-header-action-danger");
    expect(action.className).not.toContain("paper-surface");
  });

  it("omits unused slot containers", () => {
    const { container } = render(
      <PageHeader description="页面说明" title="主页面" />,
    );
    expect(container.querySelector(".page-header-slot")).toBeNull();
  });
});
