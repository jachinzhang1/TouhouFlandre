import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Paper } from "./Paper";

describe("Paper", () => {
  it("renders a linked tinted folded paper with hover unfolding enabled", () => {
    render(
      <Paper href="/single/daily" variant="tinted" foldSize={24}>
        每日题
      </Paper>,
    );

    const paper = screen.getByRole("link", { name: "每日题" });
    expect(paper.dataset.paperVariant).toBe("tinted");
    expect(paper.dataset.paperFolded).toBe("true");
    expect(paper.dataset.paperUnfoldHover).toBe("true");
    expect(paper.dataset.paperAnimateMount).toBe("true");
    expect(paper.style.getPropertyValue("--paper-fold-size")).toBe("24px");
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
