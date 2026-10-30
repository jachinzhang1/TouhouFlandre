import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmStatsClearDialog, StatsImportDialog } from "./StatsDataDialogs";

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
    const additionPaper = screen.getByText("新增").closest(".paper-surface");
    const updatePaper = screen
      .getByText("同 ID 更新")
      .closest(".paper-surface");
    expect(additionPaper?.closest(".paper-sticker")).toBeTruthy();
    expect(additionPaper?.getAttribute("data-paper-tone")).toBe("success");
    expect(additionPaper?.classList.contains("stats-import-count-new")).toBe(
      false,
    );
    expect(updatePaper?.closest(".paper-sticker")).toBeTruthy();
    expect(updatePaper?.getAttribute("data-paper-tone")).toBe("warning");
    expect(updatePaper?.classList.contains("stats-import-count-update")).toBe(
      false,
    );

    const close = screen.getByRole("button", { name: "关闭" });
    expect(close.querySelector(".lucide-x")).toBeTruthy();
    expect(close.classList.contains("paper-surface")).toBe(true);

    const replace = screen.getByRole("button", { name: "覆盖导入" });
    const merge = screen.getByRole("button", { name: "合并导入" });
    expect(replace.className).toContain("paper-button-danger");
    expect(replace.className).toContain("paper-button-filled");
    expect(merge.className).toContain("paper-button-success");
    expect(merge.className).toContain("paper-button-filled");

    fireEvent.click(replace);
    fireEvent.click(merge);
    expect(onApply).toHaveBeenNthCalledWith(1, "replace");
    expect(onApply).toHaveBeenNthCalledWith(2, "merge");
  });

  it("traps focus, closes on Escape, and restores the trigger", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            打开清除确认
          </button>
          {open ? (
            <ConfirmStatsClearDialog
              onCancel={() => setOpen(false)}
              onConfirm={() => undefined}
            />
          ) : null}
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "打开清除确认" });
    await user.click(trigger);
    const close = screen.getByRole("button", { name: "关闭" });
    expect(document.activeElement).toBe(close);
    expect(document.body.style.overflow).toBe("hidden");
    expect(trigger.inert).toBe(true);

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "确认清除" }),
    );
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(trigger.inert).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });
});
