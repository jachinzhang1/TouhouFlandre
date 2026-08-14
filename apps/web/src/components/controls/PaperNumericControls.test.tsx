import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  PaperNumberInput,
  PaperRange,
  PaperSwitch,
} from "./PaperNumericControls";

describe("paper numeric controls", () => {
  it("uses fixed cut-corner shapes and plain disabled states", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PaperSwitch ariaLabel="启用限制" checked onChange={onChange} />,
    );
    const control = screen.getByRole("switch", { name: "启用限制" });
    expect(control.dataset.paperVariant).toBe("tinted");
    expect(control.dataset.paperFolded).toBe("false");
    expect(control.dataset.paperUnfoldHover).toBe("false");
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(false);

    rerender(
      <PaperSwitch ariaLabel="启用限制" checked disabled onChange={onChange} />,
    );
    expect(control.dataset.paperVariant).toBe("plain");
    expect(control.dataset.paperFolded).toBe("false");
  });

  it("reports range values as numbers", () => {
    const onChange = vi.fn();
    render(
      <PaperRange
        ariaLabel="限制滑块"
        min={1}
        max={10}
        value={4}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByRole("slider", { name: "限制滑块" }), {
      target: { value: "7" },
    });
    expect(onChange).toHaveBeenCalledWith(7);
  });

  it("renders a standard numeric input with suffix", () => {
    const onChange = vi.fn();
    render(
      <PaperNumberInput
        ariaLabel="限制数值"
        min={1}
        max={10}
        value={4}
        suffix="手"
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: "限制数值" }), {
      target: { value: "8" },
    });
    expect(onChange).toHaveBeenCalledWith(8);
    expect(screen.getByText("手")).toBeTruthy();
  });
});
