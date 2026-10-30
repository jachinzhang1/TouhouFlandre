import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import NotFound from "./not-found";

describe("NotFound", () => {
  it("renders the remote transparent prayer animation and minimal copy", () => {
    const { container } = render(<NotFound />);

    expect(screen.getByRole("heading", { name: "页面不存在" })).toBeTruthy();
    expect(screen.getByText("少女祈祷中……")).toBeTruthy();

    const image = screen.getByRole("img", { name: "少女祈祷中动画" });
    expect(image.getAttribute("src")).toContain("media.tenor.com");
    expect(image.getAttribute("referrerpolicy")).toBe("no-referrer");

    const code = container.querySelector(".not-found-code");
    expect(code?.textContent?.trim()).toBe("404");
    expect(code?.getAttribute("aria-hidden")).toBe("true");
  });
});
