import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PaperSearchInput } from "./PaperSearchInput";
import {
  PaperSegmentButton,
  PaperSegmentGroup,
  PaperSegmentSeparator,
} from "./PaperSegmentedControl";
import { PaperButton } from "./PaperButton";
import { PaperSelect } from "./PaperSelect";
import { PaperPicker } from "./PaperPicker";

describe("Paper controls", () => {
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

  it("renders pressable actions as folded Paper without sticker movement", () => {
    render(
      <PaperButton filled onClick={() => undefined} tone="theme">
        应用
      </PaperButton>,
    );

    const button = screen.getByRole("button", { name: "应用" });
    expect(button.dataset.paperVariant).toBe("tinted");
    expect(button.dataset.paperFolded).toBe("true");
    expect(button.closest(".paper-sticker")).toBeNull();
    expect(button.className).toContain("paper-button-filled");
  });

  it("marks filled danger actions as tinted Paper surfaces", () => {
    render(
      <PaperButton filled onClick={() => undefined} tone="danger">
        放弃游戏
      </PaperButton>,
    );

    const button = screen.getByRole("button", { name: "放弃游戏" });
    expect(button.dataset.paperVariant).toBe("tinted");
    expect(button.classList.contains("paper-button-filled")).toBe(true);
  });

  it("uses the shared plain unfolded state for disabled Paper buttons", () => {
    render(
      <PaperButton disabled filled onClick={() => undefined} tone="danger">
        删除
      </PaperButton>,
    );

    const button = screen.getByRole("button", { name: "删除" });
    expect(button.dataset.paperDisabled).toBe("true");
    expect(button.dataset.paperVariant).toBe("plain");
    expect(button.dataset.paperFolded).toBe("false");
    expect(button.dataset.paperUnfoldHover).toBe("false");
    expect(button.classList.contains("paper-button-filled")).toBe(false);
  });

  it("wraps native selects in a focusable folded Paper surface", () => {
    render(
      <PaperSelect aria-label="难度" defaultValue="normal">
        <option value="easy">Easy</option>
        <option value="normal">Normal</option>
      </PaperSelect>,
    );

    const select = screen.getByRole("combobox", { name: "难度" });
    const paper = select.closest(".paper-surface") as HTMLElement;
    expect((select as HTMLSelectElement).value).toBe("normal");
    expect(paper.dataset.paperFolded).toBe("true");
    expect(paper.closest(".paper-sticker")).toBeNull();
  });

  it("uses a native select inside prominent tinted Paper", () => {
    render(
      <PaperPicker aria-label="多人玩法" defaultValue="race">
        <option value="race">竞速</option>
        <option value="relay">接力</option>
      </PaperPicker>,
    );

    const picker = screen.getByRole("combobox", { name: "多人玩法" });
    const paper = picker.closest(".paper-surface") as HTMLElement;
    expect(picker.tagName).toBe("SELECT");
    expect(paper.dataset.paperVariant).toBe("tinted");
    expect(paper.dataset.paperFolded).toBe("true");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("supports standard plain Paper pickers", () => {
    render(
      <PaperPicker aria-label="每页记录数" defaultValue="10" variant="plain">
        <option value="10">10</option>
        <option value="25">25</option>
      </PaperPicker>,
    );

    const picker = screen.getByRole("combobox", { name: "每页记录数" });
    const paper = picker.closest(".paper-picker-control") as HTMLElement;
    expect(paper.dataset.paperVariant).toBe("plain");
    expect(paper.classList.contains("paper-select-control-compact")).toBe(
      false,
    );
  });
});
