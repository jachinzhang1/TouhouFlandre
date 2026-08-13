import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Paper } from "./Paper";

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
    expect(paper.dataset.paperUnfoldHover).toBe("true");
    expect(paper.dataset.paperAnimateMount).toBe("true");
    expect(paper.style.getPropertyValue("--paper-fold-size")).toBe("24px");
    const sticker = paper.closest(".paper-sticker") as HTMLElement;
    expect(sticker.dataset.paperSticker).toBe("true");
    expect(sticker.style.zIndex).toBe("4");
    expect(sticker.querySelector(".paper-sticker-cast")).toBeTruthy();
    expect(sticker.querySelector(".paper-sticker-soft-blur")).toBeTruthy();
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
