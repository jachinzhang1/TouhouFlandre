import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PublicGameSession } from "@touhouflandre/shared";
import { SingleGamePage } from "./SingleGamePage";

const playingSession = {
  id: "sess-1",
  status: "playing",
  puzzleKey: "2026-08-05",
  maxGuesses: 8,
  startedAt: new Date(Date.now() - 65_000).toISOString(),
  guesses: [],
} as unknown as PublicGameSession;

const wonSession = {
  ...playingSession,
  status: "won",
  guesses: [
    {
      guessId: "patchouli_knowledge",
      guessName: "帕秋莉·诺蕾姬",
      guessAvatarUrl: "/characters/0006-帕秋莉·诺蕾姬.png",
      feedback: [],
    },
  ],
  answer: {
    id: "patchouli_knowledge",
    names: { zhHans: "帕秋莉·诺蕾姬" },
    avatarUrl: "/characters/0006-帕秋莉·诺蕾姬.png",
    firstAppearance: {
      workId: "th06_eosd",
      workTitle: "东方红魔乡",
      mainlineIndex: 6,
    },
  },
} as unknown as PublicGameSession;

const sessionWithGuess = {
  ...playingSession,
  guesses: wonSession.guesses,
} as unknown as PublicGameSession;

const nextDailySession = {
  ...playingSession,
  id: "sess-next-day",
  puzzleKey: "2026-08-06",
} as unknown as PublicGameSession;

const forfeitedSession = {
  ...playingSession,
  status: "lost",
  endedAt: new Date().toISOString(),
  guesses: sessionWithGuess.guesses,
  answer: {
    id: "patchouli_knowledge",
    names: { zhHans: "帕秋莉·诺蕾姬" },
    avatarUrl: "/characters/0006-帕秋莉·诺蕾姬.png",
    firstAppearance: {
      workId: "th06_eosd",
      workTitle: "东方红魔乡",
      mainlineIndex: 6,
    },
  },
} as unknown as PublicGameSession;

const { searchHookMock } = vi.hoisted(() => ({
  searchHookMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../lib/api", () => ({
  api: {
    catalog: vi.fn(),
    getSession: vi.fn(),
    createPuzzle: vi.fn(),
    submitGuess: vi.fn(),
    forfeitSession: vi.fn(),
  },
}));

vi.mock("../hooks/useCharacterSearch", () => ({
  useCharacterSearch: searchHookMock,
}));

import { api } from "../lib/api";

describe("SingleGamePage", () => {
  beforeEach(() => {
    vi.mocked(api.catalog).mockReset();
    vi.mocked(api.getSession).mockReset();
    vi.mocked(api.createPuzzle).mockReset();
    vi.mocked(api.submitGuess).mockReset();
    vi.mocked(api.forfeitSession).mockReset();
    searchHookMock.mockReset();
    searchHookMock.mockReturnValue({
      results: [
        {
          id: "patchouli_knowledge",
          name: "帕秋莉·诺蕾姬",
          subtitle: "Patchouli Knowledge · 东方红魔乡",
          avatarUrl: "/characters/0006-帕秋莉·诺蕾姬.png",
          initials: "帕秋",
          workId: "th06_eosd",
          hairColors: ["purple"],
        },
      ],
      total: 1,
      error: "",
      loading: false,
      retry: vi.fn(),
    });
    localStorage.clear();
  });

  it("creates a daily puzzle and shows initial progress", async () => {
    vi.mocked(api.catalog).mockResolvedValue({
      dailyDateKey: "2026-08-05",
      contents: [],
    } as never);
    vi.mocked(api.createPuzzle).mockResolvedValue({
      session: playingSession,
      puzzleLabel: "每日题 2026-08-05",
    } as never);

    render(<SingleGamePage mode="daily" />);

    expect(await screen.findByText("每日题 2026-08-05")).toBeTruthy();
    expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeTruthy();
    expect(screen.getByText("0/8")).toBeTruthy();
    expect(screen.getByText("进行中")).toBeTruthy();
    expect(localStorage.getItem("touhouflandre:daily-session")).toContain(
      "sess-1",
    );
    expect(screen.queryByLabelText("重新开始随机题")).toBeNull();
  });

  it("renders win panel after guessing correctly", async () => {
    vi.mocked(api.catalog).mockResolvedValue({
      dailyDateKey: "2026-08-05",
      contents: [],
    } as never);
    vi.mocked(api.createPuzzle).mockResolvedValue({
      session: playingSession,
      puzzleLabel: "每日题 2026-08-05",
    } as never);
    vi.mocked(api.submitGuess).mockResolvedValue(wonSession as never);

    render(<SingleGamePage mode="daily" />);
    await screen.findByText("每日题 2026-08-05");

    await userEvent.type(screen.getByLabelText("搜索东方角色"), "帕秋莉");
    await userEvent.click(screen.getByText("帕秋莉·诺蕾姬"));
    await userEvent.click(screen.getByText("提交猜测"));

    expect(await screen.findByText("猜中了")).toBeTruthy();
    expect(screen.getByText(/共使用 1 次猜测/)).toBeTruthy();
    expect(screen.queryByText("复制分享")).toBeNull();
    expect(screen.queryByText("再来一局")).toBeNull();
  });

  it("forfeits the current session and reveals the answer", async () => {
    vi.mocked(api.catalog).mockResolvedValue({
      dailyDateKey: "2026-08-05",
      contents: [],
    } as never);
    vi.mocked(api.createPuzzle).mockResolvedValue({
      session: playingSession,
      puzzleLabel: "每日题 2026-08-05",
    } as never);
    vi.mocked(api.forfeitSession).mockResolvedValue(forfeitedSession as never);

    render(<SingleGamePage mode="daily" />);
    await screen.findByText("每日题 2026-08-05");

    await userEvent.click(screen.getByLabelText("放弃本局"));

    expect(await screen.findByText("本次游戏结束")).toBeTruthy();
    expect(screen.getByText("帕秋莉·诺蕾姬", { selector: "strong" })).toBeTruthy();
    expect(
      screen.getByText("--:--", { selector: ".guess-duration" }),
    ).toBeTruthy();
  });

  it("restores the same daily session and keeps its guesses", async () => {
    localStorage.setItem(
      "touhouflandre:daily-session",
      JSON.stringify({ id: "sess-1", puzzleKey: "2026-08-05" }),
    );
    vi.mocked(api.catalog).mockResolvedValue({
      dailyDateKey: "2026-08-05",
      contents: [],
    } as never);
    vi.mocked(api.getSession).mockResolvedValue(sessionWithGuess as never);

    render(<SingleGamePage mode="daily" />);

    expect(await screen.findByText("1/8")).toBeTruthy();
    expect(screen.getByText("帕秋莉·诺蕾姬")).toBeTruthy();
    expect(api.createPuzzle).not.toHaveBeenCalled();
  });

  it("creates a clean daily session after the date changes", async () => {
    localStorage.setItem(
      "touhouflandre:daily-session",
      JSON.stringify({ id: "sess-1", puzzleKey: "2026-08-05" }),
    );
    vi.mocked(api.catalog).mockResolvedValue({
      dailyDateKey: "2026-08-06",
      contents: [],
    } as never);
    vi.mocked(api.getSession).mockResolvedValue(sessionWithGuess as never);
    vi.mocked(api.forfeitSession).mockResolvedValue(forfeitedSession as never);
    vi.mocked(api.createPuzzle).mockResolvedValue({
      session: nextDailySession,
      puzzleLabel: "每日题 2026-08-06",
    } as never);

    render(<SingleGamePage mode="daily" />);

    expect(await screen.findByText("每日题 2026-08-06")).toBeTruthy();
    expect(screen.getByText("0/8")).toBeTruthy();
    expect(localStorage.getItem("touhouflandre:daily-session")).toContain(
      "sess-next-day",
    );
  });

  it("requires confirmation before discarding random progress", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    vi.mocked(api.createPuzzle).mockResolvedValue({
      session: sessionWithGuess,
      puzzleLabel: "随机题",
    } as never);

    render(<SingleGamePage mode="random" />);
    await screen.findByText("1/8");
    await userEvent.click(screen.getByLabelText("重新开始随机题"));

    expect(confirm).toHaveBeenCalledOnce();
    expect(api.createPuzzle).toHaveBeenCalledOnce();
    confirm.mockRestore();
  });

  it("selects a search suggestion with the keyboard", async () => {
    vi.mocked(api.catalog).mockResolvedValue({
      dailyDateKey: "2026-08-05",
      contents: [],
    } as never);
    vi.mocked(api.createPuzzle).mockResolvedValue({
      session: playingSession,
      puzzleLabel: "每日题 2026-08-05",
    } as never);

    render(<SingleGamePage mode="daily" />);
    const input = await screen.findByLabelText("搜索东方角色");
    await userEvent.type(input, "帕秋莉");
    await userEvent.keyboard("{ArrowDown}{Enter}");

    expect((input as HTMLInputElement).value).toBe("帕秋莉·诺蕾姬");
    const submit = screen.getByText("提交猜测").closest("button");
    expect(submit).not.toBeNull();
    expect(submit?.disabled).toBe(false);
    await waitFor(() =>
      expect(searchHookMock).toHaveBeenCalledWith(
        "帕秋莉·诺蕾姬",
        expect.objectContaining({ sessionId: "sess-1" }),
      ),
    );
  });
});
