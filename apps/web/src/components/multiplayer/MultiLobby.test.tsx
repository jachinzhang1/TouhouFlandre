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
    await userEvent.click(view);
    expect(mocks.push).toHaveBeenCalledWith(
      "/settings?source=multi&room=ABC234",
    );
  });
});
