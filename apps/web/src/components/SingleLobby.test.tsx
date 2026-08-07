import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SingleLobby } from "./SingleLobby";

describe("SingleLobby", () => {
  it("只展示三个可用游戏入口，并统一可用状态配色", () => {
    render(<SingleLobby />);

    expect(
      screen.getByRole("link", { name: /每日题/ }).getAttribute("href"),
    ).toBe("/single/daily");
    expect(
      screen.getByRole("link", { name: /随机题/ }).getAttribute("href"),
    ).toBe("/single/random");
    expect(
      screen.getByRole("link", { name: /多人大厅/ }).getAttribute("href"),
    ).toBe("/multi");
    expect(screen.queryByText("多人房间")).toBeNull();
    expect(screen.queryByText("暂未开放")).toBeNull();

    for (const label of ["今日可玩", "不限次数", "已开放"]) {
      expect(screen.getByText(label).className).toContain("bg-jade-soft");
    }
  });
});
