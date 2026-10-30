import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Paper } from "@/components/paper";

describe("Paper", () => {
  it("renders a linked tinted folded paper with hover unfolding enabled", () => {
    render(
      <Paper href="/single/daily" variant="tinted" foldSize={24} stackOrder={4}>
        每日题
      </Paper>,
    );

    const paper = screen.getByRole("link", { name: "每日题" });
    expect(paper.dataset.paperVariant).toBe("tinted");
    expect(paper.dataset.paperFolded).toBe("true");
    expect(paper.dataset.paperShape).toBe("note");
    expect(paper.dataset.paperUnfoldHover).toBe("true");
    expect(paper.dataset.paperAnimateMount).toBe("true");
    expect(paper.dataset.paperPattern).toBe("none");
    expect(paper.style.getPropertyValue("--paper-fold-size")).toBe("24px");
    const sticker = paper.closest(".paper-sticker") as HTMLElement;
    expect(sticker.dataset.paperSticker).toBe("true");
    expect(sticker.style.zIndex).toBe("4");
    expect(sticker.querySelector(".paper-sticker-cast")).toBeTruthy();
    expect(sticker.querySelector(".paper-sticker-soft-blur")).toBeTruthy();
  });

  it("exposes canonical tone, pattern, and static elevation states", () => {
    const { container } = render(
      <Paper elevation="lg" pattern={false} sticker={false} tone="danger">
        错误纸片
      </Paper>,
    );

    const paper = container.querySelector(".paper-surface") as HTMLElement;
    expect(paper.dataset.paperTone).toBe("danger");
    expect(paper.dataset.paperPattern).toBe("none");
    expect(paper.dataset.paperElevation).toBe("lg");
  });

  it("supports interactive button papers", () => {
    let clicks = 0;
    render(
      <Paper as="button" onClick={() => (clicks += 1)}>
        题库设置
      </Paper>,
    );

    fireEvent.click(screen.getByRole("button", { name: "题库设置" }));
    expect(clicks).toBe(1);
  });

  it("removes tint, fold, and hover behavior from disabled buttons", () => {
    render(
      <Paper as="button" disabled folded unfoldOnHover variant="tinted">
        禁用操作
      </Paper>,
    );

    const paper = screen.getByRole("button", { name: "禁用操作" });
    expect((paper as HTMLButtonElement).disabled).toBe(true);
    expect(paper.dataset.paperDisabled).toBe("true");
    expect(paper.dataset.paperVariant).toBe("plain");
    expect(paper.dataset.paperFolded).toBe("false");
    expect(paper.dataset.paperUnfoldHover).toBe("false");
    expect(paper.style.background).toBe("");
  });

  it("can preserve selected appearance for non-interactive read-only Paper", () => {
    render(
      <Paper
        as="button"
        disabled
        folded
        preserveAppearanceWhenDisabled
        variant="tinted"
      >
        已选条件
      </Paper>,
    );

    const paper = screen.getByRole("button", { name: "已选条件" });
    expect((paper as HTMLButtonElement).disabled).toBe(true);
    expect(paper.dataset.paperVariant).toBe("tinted");
    expect(paper.dataset.paperFolded).toBe("false");
    expect(paper.dataset.paperPreserveAppearance).toBe("true");
  });

  it("renders disabled linked Paper as a non-navigating surface", () => {
    render(
      <Paper ariaDisabled href="/single/daily">
        不可用入口
      </Paper>,
    );

    const paper = screen.getByRole("link", { name: "不可用入口" });
    expect(paper.tagName).toBe("SPAN");
    expect(paper.getAttribute("aria-disabled")).toBe("true");
    expect(paper.dataset.paperDisabled).toBe("true");
    expect(paper.style.cursor).toBe("");
  });

  it("can disable sticker effects for structural papers", () => {
    const { container } = render(<Paper sticker={false}>导航纸片</Paper>);

    expect(container.querySelector(".paper-sticker")).toBeNull();
    expect(container.querySelector(".paper-surface")?.textContent).toBe(
      "导航纸片",
    );
  });

  it("supports plain unfolded non-link surfaces", () => {
    const { container } = render(
      <Paper variant="plain" folded={false} unfolded ariaHidden>
        装饰纸
      </Paper>,
    );

    const paper = container.querySelector(".paper-surface");
    expect(paper?.getAttribute("data-paper-variant")).toBe("plain");
    expect(paper?.getAttribute("data-paper-folded")).toBe("false");
    expect(paper?.getAttribute("data-paper-unfolded")).toBe("true");
    expect(paper?.getAttribute("aria-hidden")).toBe("true");
  });
});
