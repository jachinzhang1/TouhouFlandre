import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PaperNumberInput, PaperRange, PaperSwitch } from "@/components/paper";

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

  it("preserves checked and numeric appearance for disabled read-only controls", () => {
    render(
      <>
        <PaperSwitch
          ariaLabel="只读开关"
          checked
          disabled
          onChange={() => undefined}
          preserveAppearanceWhenDisabled
        />
        <PaperRange
          ariaLabel="只读滑块"
          disabled
          min={1}
          max={10}
          onChange={() => undefined}
          preserveAppearanceWhenDisabled
          value={4}
        />
        <PaperNumberInput
          ariaLabel="只读数值"
          disabled
          min={1}
          max={10}
          onChange={() => undefined}
          preserveAppearanceWhenDisabled
          suffix="手"
          value={4}
        />
      </>,
    );

    expect(
      screen.getByRole("switch", { name: "只读开关" }).dataset.paperVariant,
    ).toBe("tinted");
    for (const name of ["只读滑块", "只读数值"]) {
      expect(
        screen.getByLabelText(name).closest<HTMLElement>(".paper-surface")
          ?.dataset.paperPreserveAppearance,
      ).toBe("true");
    }
  });

  it("propagates disabled range and number states to Paper surfaces", () => {
    render(
      <>
        <PaperRange
          ariaLabel="禁用滑块"
          disabled
          min={1}
          max={10}
          value={4}
          onChange={() => undefined}
        />
        <PaperNumberInput
          ariaLabel="禁用数值"
          disabled
          min={1}
          max={10}
          value={4}
          suffix="手"
          onChange={() => undefined}
        />
      </>,
    );

    for (const name of ["禁用滑块", "禁用数值"]) {
      const input = screen.getByRole(
        name === "禁用滑块" ? "slider" : "spinbutton",
        {
          name,
        },
      );
      expect(
        input.closest<HTMLElement>(".paper-surface")?.dataset.paperDisabled,
      ).toBe("true");
    }
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
    expect(
      screen.getByRole("slider", { name: "限制滑块" }).getAttribute("step"),
    ).toBe("1");
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
