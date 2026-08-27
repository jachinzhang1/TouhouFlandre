import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FLOATING_CONTROLS_STORAGE_KEY } from "../lib/floatingControls";
import { useDraggableFloatingControl } from "./useDraggableFloatingControl";
import { useRef } from "react";

function rect({
  left,
  top,
  width,
  height,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
}): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

function DragHarness({ onClick }: { onClick: () => void }) {
  const boundaryRef = useRef<HTMLDivElement>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const { positionStyle, isDragging, dragHandleProps } =
    useDraggableFloatingControl({
      controlId: "appearance",
      boundaryRef,
      floatingRef,
      handleRef,
      getDefaultPosition: (bounds, size) => ({
        x: bounds.right - size.width,
        y: bounds.bottom - size.height,
      }),
    });

  return (
    <div ref={boundaryRef} data-testid="boundary">
      <div
        ref={floatingRef}
        data-testid="floating"
        data-dragging={isDragging}
        style={positionStyle}
      >
        <button ref={handleRef} {...dragHandleProps} onClick={onClick}>
          control
        </button>
      </div>
    </div>
  );
}

describe("useDraggableFloatingControl", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.dataset.testid === "boundary" ? 300 : 48;
      },
    );
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.dataset.testid === "boundary" ? 200 : 48;
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.dataset.testid === "boundary") {
          return rect({ left: 12, top: 12, width: 300, height: 200 });
        }
        if (this.dataset.testid === "floating") {
          return rect({ left: 264, top: 164, width: 48, height: 48 });
        }
        return rect({ left: 264, top: 164, width: 48, height: 48 });
      },
    );
  });

  it("keeps a short pointer movement as a normal click", () => {
    const onClick = vi.fn();
    render(<DragHarness onClick={onClick} />);
    const button = screen.getByRole("button", { name: "control" });

    fireEvent.pointerDown(button, {
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: 288,
      clientY: 188,
    });
    fireEvent.pointerMove(button, {
      pointerId: 1,
      isPrimary: true,
      clientX: 291,
      clientY: 192,
    });
    fireEvent.pointerUp(button, {
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: 291,
      clientY: 192,
    });
    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(FLOATING_CONTROLS_STORAGE_KEY)).toBeNull();
  });

  it("clamps and persists a drag without activating the button", () => {
    const onClick = vi.fn();
    render(<DragHarness onClick={onClick} />);
    const button = screen.getByRole("button", { name: "control" });

    fireEvent.pointerDown(button, {
      pointerId: 2,
      isPrimary: true,
      button: 0,
      clientX: 288,
      clientY: 188,
    });
    fireEvent.pointerMove(button, {
      pointerId: 2,
      isPrimary: true,
      clientX: -100,
      clientY: -100,
    });
    fireEvent.pointerUp(button, {
      pointerId: 2,
      isPrimary: true,
      button: 0,
      clientX: -100,
      clientY: -100,
    });
    fireEvent.click(button);

    expect(screen.getByTestId("floating")).toHaveStyle({
      left: "0px",
      top: "0px",
    });
    expect(onClick).not.toHaveBeenCalled();
    expect(
      JSON.parse(localStorage.getItem(FLOATING_CONTROLS_STORAGE_KEY)!),
    ).toEqual({
      schemaVersion: 1,
      positions: { appearance: { xRatio: 0, yRatio: 0 } },
    });
  });

  it("restores the starting point when the pointer is cancelled", () => {
    render(<DragHarness onClick={vi.fn()} />);
    const button = screen.getByRole("button", { name: "control" });

    fireEvent.pointerDown(button, {
      pointerId: 3,
      isPrimary: true,
      button: 0,
      clientX: 288,
      clientY: 188,
    });
    fireEvent.pointerMove(button, {
      pointerId: 3,
      isPrimary: true,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerCancel(button, {
      pointerId: 3,
      isPrimary: true,
      clientX: 100,
      clientY: 100,
    });

    expect(screen.getByTestId("floating")).toHaveStyle({
      left: "252px",
      top: "152px",
    });
    expect(localStorage.getItem(FLOATING_CONTROLS_STORAGE_KEY)).toBeNull();
  });
});
