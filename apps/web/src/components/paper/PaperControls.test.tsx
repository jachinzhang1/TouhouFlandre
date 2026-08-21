import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  PaperButton,
  PaperPicker,
  PaperSearchInput,
  PaperSegmentButton,
  PaperSegmentGroup,
  PaperSegmentSeparator,
  PaperSelect,
} from "@/components/paper";

describe("Paper controls", () => {
  it("renders a textureless folded search Paper without sticker effects", () => {
    render(
      <PaperSearchInput
        ariaLabel="搜索角色"
        onChange={() => undefined}
        placeholder="例如 灵梦"
        value=""
        endAdornment={<button type="button">清除</button>}
      />,
    );

    const input = screen.getByRole("textbox", { name: "搜索角色" });
    const paper = input.closest(".paper-surface") as HTMLElement;
    expect(input.getAttribute("placeholder")).toBe("例如 灵梦");
    expect(paper.dataset.paperFolded).toBe("true");
    expect(paper.closest(".paper-sticker")).toBeNull();
    expect(paper.dataset.paperPattern).toBe("none");
    expect(
      screen
        .getByRole("button", { name: "清除" })
        .closest(".paper-search-control-adornment"),
    ).toBeTruthy();
  });

  it("propagates disabled search state to the Paper surface and input", () => {
    render(
      <PaperSearchInput
        ariaLabel="搜索角色"
        disabled
        onChange={() => undefined}
        value=""
      />,
    );

    const input = screen.getByRole("textbox", { name: "搜索角色" });
    const paper = input.closest(".paper-surface") as HTMLElement;
    expect((input as HTMLInputElement).disabled).toBe(true);
    expect(paper.dataset.paperDisabled).toBe("true");
  });

  it("renders independently folded selected cells in a Paper group", () => {
    let selected = "first";
    const { rerender } = render(
      <PaperSegmentGroup label="显示方式">
        <PaperSegmentButton
          active={selected === "first"}
          tone="success"
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
    expect(first.dataset.paperTone).toBe("success");
    expect(first.dataset.paperPattern).toBe("none");

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
      <PaperButton ariaPressed filled onClick={() => undefined} tone="theme">
        应用
      </PaperButton>,
    );

    const button = screen.getByRole("button", { name: "应用" });
    expect(button.dataset.paperVariant).toBe("tinted");
    expect(button.dataset.paperFolded).toBe("true");
    expect(button.closest(".paper-sticker")).toBeNull();
    expect(button.className).toContain("paper-button-filled");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.dataset.paperPattern).toBe("none");
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

  it("prevents interaction for disabled Paper buttons", () => {
    let clicks = 0;
    render(
      <PaperButton disabled onClick={() => (clicks += 1)}>
        不可用操作
      </PaperButton>,
    );

    const button = screen.getByRole("button", { name: "不可用操作" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.dataset.paperDisabled).toBe("true");
    fireEvent.click(button);
    expect(clicks).toBe(0);
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

  it("propagates native select disabled state to Paper surfaces", () => {
    render(
      <>
        <PaperSelect aria-label="禁用难度" disabled>
          <option>Normal</option>
        </PaperSelect>
        <PaperPicker aria-label="禁用玩法" disabled>
          <option>竞速</option>
        </PaperPicker>
      </>,
    );

    for (const name of ["禁用难度", "禁用玩法"]) {
      const select = screen.getByRole("combobox", { name });
      expect((select as HTMLSelectElement).disabled).toBe(true);
      expect(
        select.closest<HTMLElement>(".paper-surface")?.dataset.paperDisabled,
      ).toBe("true");
    }
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
