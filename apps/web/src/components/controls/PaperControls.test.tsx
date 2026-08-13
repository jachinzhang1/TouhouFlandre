import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PaperSearchInput } from "./PaperSearchInput";
import {
  PaperSegmentButton,
  PaperSegmentGroup,
  PaperSegmentSeparator,
} from "./PaperSegmentedControl";

describe("Paper search controls", () => {
  it("renders a textureless folded search Paper without sticker effects", () => {
    render(
      <PaperSearchInput
        ariaLabel="搜索角色"
        onChange={() => undefined}
        placeholder="例如 灵梦"
        value=""
      />,
    );

    const input = screen.getByRole("textbox", { name: "搜索角色" });
    const paper = input.closest(".paper-surface") as HTMLElement;
    expect(input.getAttribute("placeholder")).toBe("例如 灵梦");
    expect(paper.dataset.paperFolded).toBe("true");
    expect(paper.closest(".paper-sticker")).toBeNull();
  });

  it("renders independently folded selected cells in a Paper group", () => {
    let selected = "first";
    const { rerender } = render(
      <PaperSegmentGroup label="显示方式">
        <PaperSegmentButton
          active={selected === "first"}
          onClick={() => (selected = "first")}
        >
          第一项
        </PaperSegmentButton>
        <PaperSegmentSeparator />
        <PaperSegmentButton
          active={selected === "second"}
          onClick={() => (selected = "second")}
        >
          第二项
        </PaperSegmentButton>
      </PaperSegmentGroup>,
    );

    const first = screen.getByRole("button", { name: "第一项" });
    expect(first.dataset.paperVariant).toBe("tinted");
    expect(first.dataset.paperFolded).toBe("true");
    expect(screen.getByRole("group", { name: "显示方式" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "第二项" }));
    rerender(
      <PaperSegmentGroup label="显示方式">
        <PaperSegmentButton
          active={selected === "first"}
          onClick={() => (selected = "first")}
        >
          第一项
        </PaperSegmentButton>
        <PaperSegmentSeparator />
        <PaperSegmentButton
          active={selected === "second"}
          onClick={() => (selected = "second")}
        >
          第二项
        </PaperSegmentButton>
      </PaperSegmentGroup>,
    );

    const second = screen.getByRole("button", { name: "第二项" });
    expect(second.dataset.paperVariant).toBe("tinted");
    expect(second.dataset.paperFolded).toBe("true");
    expect(first.dataset.paperVariant).toBe("plain");
  });
});
