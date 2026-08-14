import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StatsImportDialog } from "./StatsDataDialogs";

describe("StatsImportDialog", () => {
  it("renders hoisted summary Papers and prominent import actions", () => {
    const onApply = vi.fn();
    render(
      <StatsImportDialog
        onApply={onApply}
        onClose={() => undefined}
        preview={{ total: 12, additions: 7, replacements: 5 }}
      />,
    );

    expect(screen.getByText("已校验 12 条记录。")).toBeTruthy();
    for (const label of ["新增", "同 ID 更新"]) {
      const paper = screen.getByText(label).closest(".paper-surface");
      expect(paper?.closest(".paper-sticker")).toBeTruthy();
    }

    const close = screen.getByRole("button", { name: "关闭" });
    expect(close.querySelector(".lucide-x")).toBeTruthy();
    expect(close.classList.contains("paper-surface")).toBe(false);

    const replace = screen.getByRole("button", { name: "覆盖导入" });
    const merge = screen.getByRole("button", { name: "合并导入" });
    expect(replace.className).toContain("paper-button-danger");
    expect(replace.className).toContain("paper-button-filled");
    expect(merge.className).toContain("paper-button-jade");
    expect(merge.className).toContain("paper-button-filled");

    fireEvent.click(replace);
    fireEvent.click(merge);
    expect(onApply).toHaveBeenNthCalledWith(1, "replace");
    expect(onApply).toHaveBeenNthCalledWith(2, "merge");
  });
});
