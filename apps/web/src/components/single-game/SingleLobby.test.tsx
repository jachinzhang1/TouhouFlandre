import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SingleLobby } from "./SingleLobby";

describe("SingleLobby", () => {
  it("renders concise Paper entries for each game destination", () => {
    render(<SingleLobby />);

    expect(screen.getByRole("heading", { name: "游戏模式" })).toBeTruthy();
    expect(screen.getByText("沿着角色留下的线索抵达答案。")).toBeTruthy();
    expect(screen.queryByText("PLAY")).toBeNull();

    const daily = screen.getByRole("link", { name: /每日题/ });
    const random = screen.getByRole("link", { name: /随机题/ });
    const multiplayer = screen.getByRole("link", { name: /多人大厅/ });
    const scope = screen.getByRole("button", { name: /题库设置/ });
    expect(screen.getByText("自定义出题范围。")).toBeTruthy();

    expect(daily.getAttribute("href")).toBe("/single/daily");
    expect(random.getAttribute("href")).toBe("/single/random");
    expect(multiplayer.getAttribute("href")).toBe("/multi");

    for (const entry of [daily, random, multiplayer, scope]) {
      expect(entry.dataset.paperVariant).toBe("plain");
      expect(entry.dataset.paperFolded).toBe("true");
    }

    for (const obsoleteLabel of ["今日可玩", "不限次数", "已开放"]) {
      expect(screen.queryByText(obsoleteLabel)).toBeNull();
    }
  });
});
