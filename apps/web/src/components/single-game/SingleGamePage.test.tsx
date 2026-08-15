import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PublicGameSession } from "@touhouflandre/shared";
import { SingleGamePage } from "./SingleGamePage";

const playingSession = {
  id: "sess-1",
  mode: "daily",
  contentType: "character",
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
    names: {
      zhHans: "帕秋莉·诺蕾姬",
      ja: "パチュリー・ノーレッジ",
      en: "Patchouli Knowledge",
      aliases: [],
    },
    avatarUrl: "/characters/0006-帕秋莉·诺蕾姬.png",
    firstAppearance: {
      workId: "th06_eosd",
      workTitle: "东方红魔乡",
      mainlineIndex: 6,
    },
    species: ["魔法使"],
    abilityDisplay: "操纵火水木金土日月的能力",
    locations: ["红魔馆地下图书馆"],
    roles: ["魔法使", "图书馆管理员"],
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

const dailyEyebrow = "每日题 2026-08-05";
const dailyTitle = "Normal Level";
const nextDailyEyebrow = "每日题 2026-08-06";

const forfeitedSession = {
  ...playingSession,
  status: "lost",
  endedAt: new Date().toISOString(),
  guesses: sessionWithGuess.guesses,
  answer: {
    ...wonSession.answer,
  },
} as unknown as PublicGameSession;

const { searchHookMock, timerCheckpointMock } = vi.hoisted(() => ({
  searchHookMock: vi.fn(),
  timerCheckpointMock: vi.fn(() => 65_000),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../../lib/api", () => ({
  api: {
    catalog: vi.fn(),
    catalogFull: vi.fn(),
    getSession: vi.fn(),
    createPuzzle: vi.fn(),
    submitGuess: vi.fn(),
    forfeitSession: vi.fn(),
  },
}));

vi.mock("../../hooks/useCharacterSearch", () => ({
  useCharacterSearch: searchHookMock,
}));

vi.mock("../../stats/timer", () => ({
  useForegroundTimer: () => ({
    elapsedMs: 65_000,
    checkpoint: timerCheckpointMock,
  }),
  useWallClockTimer: () => ({
    elapsedMs: 65_000,
    checkpoint: timerCheckpointMock,
  }),
}));

import { api } from "../../lib/api";

describe("SingleGamePage", () => {
  beforeEach(() => {
    vi.mocked(api.catalog).mockReset();
    vi.mocked(api.catalogFull).mockReset();
    vi.mocked(api.getSession).mockReset();
    vi.mocked(api.createPuzzle).mockReset();
    vi.mocked(api.submitGuess).mockReset();
    vi.mocked(api.forfeitSession).mockReset();
    timerCheckpointMock.mockClear();
    vi.mocked(api.catalogFull).mockResolvedValue({
      version: "v2",
      works: [],
      characters: [],
    } as never);
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
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
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

    expect(await screen.findByText(dailyTitle)).toBeTruthy();
    expect(screen.getByText(dailyEyebrow)).toBeTruthy();
    expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeTruthy();
    expect(screen.getByText("0/8")).toBeTruthy();
    expect(screen.getByText("进行中")).toBeTruthy();
    expect(localStorage.getItem("touhouflandre:daily-session")).toContain(
      "sess-1",
    );
    expect(screen.queryByLabelText("重新开始随机题")).toBeNull();
  });

  it("keeps the guess action focused on submission", async () => {
    vi.mocked(api.catalog).mockResolvedValue({
      dailyDateKey: "2026-08-05",
      contents: [],
    } as never);
    vi.mocked(api.createPuzzle).mockResolvedValue({
      session: playingSession,
      puzzleLabel: "每日题 2026-08-05",
    } as never);

    render(<SingleGamePage mode="daily" />);
    await screen.findByText(dailyTitle);

    const submitButton = screen.getByRole("button", { name: "提交猜测" });
    expect(submitButton.querySelector(".lucide-send")).toBeTruthy();
    expect((submitButton as HTMLButtonElement).disabled).toBe(true);
    expect(submitButton.dataset.paperVariant).toBe("plain");
    expect(submitButton.dataset.paperFolded).toBe("false");
    const guessGroup = screen.getByRole("group", { name: "猜测操作" });
    expect(guessGroup.contains(screen.getByLabelText("搜索东方角色"))).toBe(
      true,
    );
    expect(guessGroup.contains(submitButton)).toBe(true);
    const legend = screen.getByRole("list", { name: "反馈图例" });
    expect(within(legend).getAllByRole("listitem")).toHaveLength(6);
    expect(within(legend).getByText("答案更高")).toBeTruthy();
    const status = screen.getByRole("region", { name: "游戏状态" });
    const difficultyGroup = screen.getByRole("group", {
      name: "每日题难度",
    });
    expect(
      difficultyGroup.querySelectorAll(".paper-segment-separator"),
    ).toHaveLength(3);
    expect(status.classList.contains("paper-surface")).toBe(false);
    expect(screen.queryByRole("button", { name: "查看图例" })).toBeNull();
    expect(screen.queryByRole("tooltip")).toBeNull();
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
    await screen.findByText(dailyTitle);

    await userEvent.type(screen.getByLabelText("搜索东方角色"), "帕秋莉");
    await userEvent.click(screen.getByText("帕秋莉·诺蕾姬"));
    await userEvent.click(screen.getByText("提交猜测"));

    expect(await screen.findByText("猜中了")).toBeTruthy();
    expect(screen.getByText(/共使用 1 次猜测/)).toBeTruthy();
    expect(screen.getByText("パチュリー・ノーレッジ")).toBeTruthy();
    expect(screen.getByText("东方红魔乡")).toBeTruthy();
    expect(screen.getByText("魔法使", { selector: "dd" })).toBeTruthy();
    expect(screen.getByText("操纵火水木金土日月的能力")).toBeTruthy();
    expect(screen.getByText("红魔馆地下图书馆")).toBeTruthy();
    expect(screen.getByText("魔法使、图书馆管理员")).toBeTruthy();
    expect(screen.queryByText("th06_eosd")).toBeNull();
    await userEvent.click(screen.getByText("复制分享"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining(window.location.origin),
    );
    expect(await screen.findByText("分享文本已复制")).toBeTruthy();
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
    await screen.findByText(dailyTitle);

    await userEvent.click(screen.getByRole("button", { name: "放弃游戏" }));

    expect(await screen.findByText("本次游戏结束")).toBeTruthy();
    expect(
      screen.getByText("帕秋莉·诺蕾姬", { selector: "strong" }),
    ).toBeTruthy();
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

    expect(await screen.findByText(nextDailyEyebrow)).toBeTruthy();
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

  it("falls back to the raw hair color and labels none as 光头", async () => {
    searchHookMock.mockReturnValue({
      results: [
        {
          id: "test_char",
          name: "测试角色",
          subtitle: "Test · 测试作品",
          avatarUrl: "/characters/0001-测试角色.png",
          initials: "测试",
          workId: "th06_eosd",
          hairColors: ["teal", "none"],
        },
      ],
      total: 1,
      error: "",
      loading: false,
      retry: vi.fn(),
    });
    vi.mocked(api.catalog).mockResolvedValue({
      dailyDateKey: "2026-08-05",
      contents: [],
    } as never);
    vi.mocked(api.createPuzzle).mockResolvedValue({
      session: playingSession,
      puzzleLabel: "每日题 2026-08-05",
    } as never);

    render(<SingleGamePage mode="daily" />);
    await screen.findByText(dailyTitle);
    await userEvent.type(screen.getByLabelText("搜索东方角色"), "测试");

    expect(await screen.findByText("teal、光头")).toBeTruthy();
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
