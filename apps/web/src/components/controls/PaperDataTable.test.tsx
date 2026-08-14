import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  PaperDataTable,
  PaperDataTableBody,
  PaperDataTableHeader,
} from "./PaperDataTable";

describe("PaperDataTable", () => {
  it("owns its flat paper surface and synchronizes detached scrolling", () => {
    render(
      <PaperDataTable>
        <PaperDataTableHeader ariaLabel="测试表头">
          <span>表头</span>
        </PaperDataTableHeader>
        <PaperDataTableBody ariaLabel="测试内容">
          <span>内容</span>
        </PaperDataTableBody>
      </PaperDataTable>,
    );

    const header = screen.getByRole("table", { name: "测试表头" });
    const body = screen.getByRole("table", { name: "测试内容" });
    const surface = body.closest(".paper-data-table") as HTMLElement;
    expect(surface.dataset.paperFolded).toBe("false");
    expect(surface.closest(".paper-sticker")).toBeNull();

    header.scrollLeft = 120;
    fireEvent.scroll(header);
    expect(body.scrollLeft).toBe(120);

    body.scrollLeft = 48;
    fireEvent.scroll(body);
    expect(header.scrollLeft).toBe(48);
  });

  it("casts its header shadow only while its sticky ancestor is stuck", async () => {
    render(
      <PaperDataTable>
        <div data-testid="sticky" style={{ position: "sticky", top: 0 }}>
          <PaperDataTableHeader ariaLabel="粘性表头">
            <span>表头</span>
          </PaperDataTableHeader>
        </div>
        <PaperDataTableBody ariaLabel="粘性内容">
          <span>内容</span>
        </PaperDataTableBody>
      </PaperDataTable>,
    );

    const sticky = screen.getByTestId("sticky");
    sticky.getBoundingClientRect = () =>
      ({
        bottom: 44,
        height: 44,
        left: 0,
        right: 320,
        top: 0,
        width: 320,
        x: 0,
        y: 0,
        toJSON: () => undefined,
      }) as DOMRect;
    const header = screen.getByRole("table", { name: "粘性表头" });
    expect(header.dataset.shadow).toBe("false");

    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 100,
    });
    fireEvent.scroll(window);
    await waitFor(() => expect(header.dataset.shadow).toBe("true"));

    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 0,
    });
    fireEvent.scroll(window);
    await waitFor(() => expect(header.dataset.shadow).toBe("false"));
  });
});
