import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MultiLobby } from "./MultiLobby";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  roomInfo: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("../../lib/api", () => ({
  api: {
    roomInfo: mocks.roomInfo,
  },
}));

describe("MultiLobby settings navigation", () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.roomInfo.mockReset();
  });

  it("uses the shared page, heading, and Paper control system", () => {
    const { container } = render(<MultiLobby />);

    expect(screen.getByRole("heading", { name: "多人大厅" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "返回" }).getAttribute("href"),
    ).toBe("/single");
    const panes = container.querySelectorAll(".multi-lobby-pane.paper-surface");
    expect(panes).toHaveLength(2);
    for (const pane of panes) {
      expect((pane as HTMLElement).dataset.paperVariant).toBe("plain");
      expect((pane as HTMLElement).dataset.paperElevation).toBe("sm");
    }
    expect(container.querySelector(".section-heading-icon")).toBeNull();

    const titleAction = screen.getByRole("button", { name: "题库设置" });
    expect(titleAction.classList.contains("page-header-action")).toBe(true);
    expect(titleAction.classList.contains("paper-surface")).toBe(false);
    expect(
      container.querySelector(".page-header-slot-right")?.contains(titleAction),
    ).toBe(true);
    expect(titleAction.querySelector(".lucide-settings")).toBeTruthy();
    expect(
      titleAction
        .closest(".visual-align")
        ?.getAttribute("data-visual-align-inset"),
    ).toBe("leading-icon-action");
    for (const button of container.querySelectorAll(
      ".multi-lobby-pane button",
    )) {
      expect(button.classList.contains("paper-surface")).toBe(true);
    }
    for (const input of container.querySelectorAll(".multi-lobby-pane input")) {
      expect(input.closest(".paper-surface")).toBeTruthy();
    }
    expect(container.querySelectorAll(".paper-text-control")).toHaveLength(3);
    expect(container.querySelector("output")).toBeNull();
    expect(
      screen
        .getByRole("group", { name: "玩家上限" })
        .classList.contains("multi-lobby-capacity-control"),
    ).toBe(true);
    const modeGroup = screen.getByRole("group", { name: "玩法" });
    expect(modeGroup.classList.contains("paper-segment-group")).toBe(true);
    expect(modeGroup.querySelectorAll(".paper-segment-button")).toHaveLength(2);
    expect(modeGroup.querySelectorAll(".paper-segment-separator")).toHaveLength(
      1,
    );
    expect(
      screen.getByRole("button", { name: /竞速/ }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: /竞速/ })
        .getAttribute("aria-describedby"),
    ).toBe("mode-rule-race");
    expect(
      screen.getByRole("button", { name: /竞速/ }).dataset.paperFolded,
    ).toBe("false");
    const formatGroup = screen.getByRole("radiogroup", {
      name: "双人赛制",
    });
    expect(formatGroup.classList.contains("paper-radio-group")).toBe(true);
    expect(formatGroup.querySelectorAll('[role="radio"]')).toHaveLength(4);
    expect(
      screen.getByRole("radio", { name: /BO3/ }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getByRole("radio", { name: /BO3/ }).dataset.paperFolded).toBe(
      "true",
    );
    expect(
      screen.getByRole("radio", { name: /BO3/ }).querySelector(".lucide-check"),
    ).toBeTruthy();

    const create = screen.getByRole("button", { name: "创建房间" });
    expect(create.classList.contains("paper-button-filled")).toBe(true);
    expect(create.dataset.paperVariant).toBe("tinted");
    const join = screen.getByRole("button", { name: "加入房间" });
    expect((join as HTMLButtonElement).disabled).toBe(true);
    expect(join.dataset.paperDisabled).toBe("true");
    expect(screen.getByRole("radio", { name: /BO3/ }).dataset.paperFolded).toBe(
      "true",
    );
    expect(join.dataset.paperVariant).toBe("plain");
    expect(join.classList.contains("paper-button-filled")).toBe(false);
    expect(
      screen.getByLabelText("房间号").getAttribute("aria-describedby"),
    ).toBe("multi-lobby-join-help");
    expect(document.getElementById("multi-lobby-join-help")?.textContent).toBe(
      "输入好友分享的 6 位房间号；检查通过后即可加入。",
    );
    const scope = screen.getByRole("button", {
      name: "查看房主所设题库",
    });
    expect(scope.classList.contains("paper-button-compact")).toBe(false);
  });

  it("opens editable settings as a standalone page", async () => {
    render(<MultiLobby />);
    await userEvent.click(screen.getByRole("button", { name: "题库设置" }));
    expect(mocks.push).toHaveBeenCalledWith("/settings?source=multi");
  });

  it("opens the room owner's scope as a read-only settings page", async () => {
    mocks.roomInfo.mockResolvedValue({
      format: "bo1",
      memberCount: 1,
      mode: "race",
      questionScope: {},
      turnSeconds: 60,
    });
    render(<MultiLobby />);

    const code = screen.getByPlaceholderText(/ABC123/);
    fireEvent.change(code, { target: { value: "ABC234" } });
    fireEvent.blur(code);
    await waitFor(() => expect(mocks.roomInfo).toHaveBeenCalledWith("ABC234"));
    const view = screen.getByRole("button", { name: "查看房主所设题库" });
    await waitFor(() =>
      expect((view as HTMLButtonElement).disabled).toBe(false),
    );
    expect(screen.getByText(/已找到房间/)).toBeTruthy();
    expect(
      document
        .getElementById("multi-lobby-join-help")
        ?.classList.contains("multi-lobby-status-success"),
    ).toBe(true);
    await userEvent.click(view);
    expect(mocks.push).toHaveBeenCalledWith(
      "/settings?source=multi&room=ABC234",
    );
  });
});
