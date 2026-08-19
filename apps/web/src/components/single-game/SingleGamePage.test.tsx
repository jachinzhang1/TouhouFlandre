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
  questionScope: {
    schemaVersion: 2,
    catalogVersion: "v2",
    mode: "preset",
    difficulty: "normal",
    selectedCharacterIds: [],
    workStates: [],
    rules: {
      fields: {
        firstAppearance: true,
        releaseYear: "directional",
        species: true,
        affiliations: true,
        locations: true,
        hairColors: true,
      },
      turnLimit: { enabled: false, seconds: 30 },
      guessLimit: { enabled: true, maxGuesses: 8 },
    },
  },
  startedAt: new Date(Date.now() - 65_000).toISOString(),
  guesses: [],
} as unknown as PublicGameSession;

const wonSession = {
  ...playingSession,
  status: "won",
  guesses: [
    {
      kind: "guess",
      guessId: "patchouli_knowledge",
      guessName: "帕秋莉·诺蕾姬",
      guessAvatarUrl: "/characters/0006-帕秋莉·诺蕾姬.png",
      isCorrect: true,
      feedback: [],
    },
  ],
  answer: {
    id: "patchouli_knowledge",
    names: {
      zhHans: "帕秋莉·诺蕾姬",
      ja: "パチュリー・ノーレッジ",
      en: "Patchouli Knowledge",
      romaji: "Pachurii Noorejji",
      aliases: ["帕秋莉", "姆Q"],
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

const {
  foregroundEnabledMock,
  searchHookMock,
  timerCheckpointMock,
  wallClockEnabledMock,
} = vi.hoisted(() => ({
  foregroundEnabledMock: vi.fn(),
  searchHookMock: vi.fn(),
  timerCheckpointMock: vi.fn(() => 65_000),
  wallClockEnabledMock: vi.fn(),
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
  useForegroundTimer: (_key: string, enabled: boolean) => {
    foregroundEnabledMock(enabled);
    return {
      elapsedMs: enabled ? 65_000 : 0,
      checkpoint: () => (enabled ? timerCheckpointMock() : 0),
    };
  },
  useWallClockTimer: (_key: string, enabled: boolean) => {
    wallClockEnabledMock(enabled);
    return {
      elapsedMs: enabled ? 65_000 : 0,
      checkpoint: () => (enabled ? timerCheckpointMock() : 0),
    };
  },
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
    foregroundEnabledMock.mockClear();
    wallClockEnabledMock.mockClear();
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
    const progress = screen.getByRole("progressbar", {
      name: "猜测进度 0/8",
    });
    expect(progress.children).toHaveLength(8);
    expect(
      progress.querySelectorAll(".progress-segment.is-filled"),
    ).toHaveLength(0);
    expect(screen.getByText("进行中")).toBeTruthy();
    expect(localStorage.getItem("touhouflandre:daily-session")).toContain(
      "sess-1",
    );
    expect(screen.queryByLabelText("重新开始随机题")).toBeNull();
    expect(foregroundEnabledMock).toHaveBeenLastCalledWith(false);
    expect(wallClockEnabledMock).toHaveBeenLastCalledWith(false);
    expect(screen.getByText("00:00")).toBeTruthy();
  });

  it.each(["daily", "random"] as const)(
    "starts the %s timer only after the first guess",
    async (mode) => {
      const created = {
        ...playingSession,
        id: `session-${mode}`,
        mode,
      } as PublicGameSession;
      const guessed = {
        ...sessionWithGuess,
        id: `session-${mode}`,
        mode,
      } as PublicGameSession;
      if (mode === "daily") {
        vi.mocked(api.catalog).mockResolvedValue({
          dailyDateKey: "2026-08-05",
          contents: [],
        } as never);
      }
      vi.mocked(api.createPuzzle).mockResolvedValue({
        session: created,
        puzzleLabel: mode === "daily" ? "每日题 2026-08-05" : "随机题",
      } as never);
      vi.mocked(api.submitGuess).mockResolvedValue(guessed as never);

      render(<SingleGamePage mode={mode} />);
      const input = await screen.findByLabelText("搜索东方角色");
      expect(foregroundEnabledMock).toHaveBeenLastCalledWith(false);
      expect(wallClockEnabledMock).toHaveBeenLastCalledWith(false);

      foregroundEnabledMock.mockClear();
      wallClockEnabledMock.mockClear();
      await userEvent.type(input, "帕秋莉");
      await userEvent.click(screen.getByText("帕秋莉·诺蕾姬"));
      await userEvent.click(screen.getByRole("button", { name: "提交猜测" }));
      await screen.findByText("1/8");

      expect(foregroundEnabledMock).toHaveBeenLastCalledWith(mode === "random");
      expect(wallClockEnabledMock).toHaveBeenLastCalledWith(mode === "daily");
    },
  );

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
    const searchControl = screen
      .getByLabelText("搜索东方角色")
      .closest(".paper-search-control") as HTMLElement;
    expect(searchControl).toBeTruthy();
    expect(searchControl.classList.contains("single-game-search-control")).toBe(
      true,
    );
    expect(searchControl.dataset.paperFolded).toBe("false");
    expect(
      searchControl.querySelector(".paper-search-control-input"),
    ).toBeTruthy();
    expect(guessGroup.contains(screen.getByLabelText("搜索东方角色"))).toBe(
      true,
    );
    expect(guessGroup.contains(submitButton)).toBe(true);
    const legend = screen.getByRole("list", { name: "反馈图例" });
    expect(within(legend).getAllByRole("listitem")).toHaveLength(6);
    expect(
      legend.querySelectorAll(".feedback-legend-scroll-spacer"),
    ).toHaveLength(2);
    expect(within(legend).getByText("答案更高")).toBeTruthy();
    expect(within(legend).getByText("未知，遇到请反馈")).toBeTruthy();
    const status = screen.getByRole("region", { name: "游戏状态" });
    const difficultyGroup = screen.getByRole("group", {
      name: "每日题难度",
    });
    expect(
      difficultyGroup.querySelectorAll(".paper-segment-separator"),
    ).toHaveLength(3);
    const difficultyButtons = within(difficultyGroup).getAllByRole("button");
    expect(difficultyButtons).toHaveLength(4);
    expect(
      difficultyButtons.every((button) =>
        button.classList.contains("paper-segment-button"),
      ),
    ).toBe(true);
    expect(
      difficultyButtons.every(
        (button) =>
          button.firstElementChild?.tagName === "svg" &&
          button.firstElementChild.getAttribute("width") === "16",
      ),
    ).toBe(true);
    expect(
      difficultyButtons.map((button) => button.dataset.paperVariant),
    ).toEqual(["plain", "tinted", "plain", "plain"]);
    expect(difficultyButtons[0].classList.contains("difficulty-easy")).toBe(
      true,
    );
    expect(difficultyButtons[1].classList.contains("difficulty-normal")).toBe(
      true,
    );
    const metrics = status.querySelector(".single-game-metrics");
    expect(status.children[1]).toBe(metrics);
    expect(status.children[2]).toBe(difficultyGroup);
    const forfeit = screen.getByRole("button", { name: "放弃游戏" });
    expect(forfeit.classList.contains("paper-button-filled")).toBe(true);
    expect(forfeit.classList.contains("paper-button-compact")).toBe(false);
    expect(forfeit.querySelector("svg")?.getAttribute("width")).toBe("18");
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

    expect(await screen.findByText("恭喜你，猜中了！")).toBeTruthy();
    const resultSection = screen.getByRole("region", { name: "游戏结果" });
    expect(resultSection.classList.contains("single-game-result-section")).toBe(
      true,
    );
    expect(resultSection.dataset.result).toBe("won");
    expect(
      resultSection.querySelector(".result-panel.paper-surface"),
    ).toBeNull();
    expect(screen.queryByText("Clear")).toBeNull();
    const history = screen.getByRole("region", { name: "猜测记录" });
    expect(history.dataset.scrollLocked).toBe("true");
    expect(
      history
        .querySelector("tbody tr:last-child")
        ?.classList.contains("guess-correct-row"),
    ).toBe(true);
    expect(
      (screen.getByLabelText("搜索东方角色") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "提交猜测" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    const completedProgress = screen.getByRole("progressbar", {
      name: "猜测进度 1/8",
    });
    expect(
      completedProgress.querySelectorAll(".progress-segment.is-filled"),
    ).toHaveLength(1);
    const resultSummary = resultSection.querySelector(".result-summary");
    expect(resultSummary?.textContent).toBe(
      "恭喜你，猜中了！你用1次机会猜出了帕秋莉·诺蕾姬。",
    );
    expect(screen.getByText("パチュリー・ノーレッジ")).toBeTruthy();
    expect(screen.getByText("Pachurii Noorejji")).toBeTruthy();
    expect(screen.queryByText("帕秋莉、姆Q")).toBeNull();
    expect(screen.getByText("东方红魔乡")).toBeTruthy();
    expect(screen.getByText("魔法使", { selector: "dd" })).toBeTruthy();
    expect(screen.getByText("操纵火水木金土日月的能力")).toBeTruthy();
    expect(screen.getByText("红魔馆地下图书馆")).toBeTruthy();
    expect(screen.getByText("魔法使、图书馆管理员")).toBeTruthy();
    expect(screen.queryByText("th06_eosd")).toBeNull();
    const resultPanel = resultSection.querySelector(".result-panel");
    expect(resultPanel?.children[0].classList.contains("result-info")).toBe(
      true,
    );
    expect(resultPanel?.children[1].classList.contains("answer-token")).toBe(
      true,
    );
    const shareButton = screen.getByRole("button", { name: "复制分享" });
    expect(shareButton.closest(".result-title-row")).toBeTruthy();
    expect(shareButton.classList.contains("paper-button-filled")).toBe(true);
    await userEvent.click(shareButton);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining(window.location.origin),
    );
    expect(await screen.findByText("分享文本已复制")).toBeTruthy();
    expect(screen.queryByText("再来一局")).toBeNull();
  });

  it("forfeits the current session and reveals the answer", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
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
    const lostSummary = screen
      .getByRole("region", { name: "游戏结果" })
      .querySelector(".result-summary p");
    expect(lostSummary?.textContent).toBe(
      "你用尽了1次机会也没能猜出帕秋莉·诺蕾姬。",
    );
    const history = screen.getByRole("region", { name: "猜测记录" });
    expect(history.dataset.completed).toBe("true");
    expect(history.dataset.scrollLocked).toBe("true");
    expect(
      history
        .querySelector("tbody tr:last-child")
        ?.classList.contains("guess-final-row"),
    ).toBe(true);
    expect(
      screen.getByText("帕秋莉·诺蕾姬", { selector: "strong" }),
    ).toBeTruthy();
    expect(
      screen.getByText("--:--", { selector: ".guess-duration" }),
    ).toBeTruthy();
    expect(confirm).toHaveBeenCalledOnce();
    confirm.mockRestore();
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
    expect(api.forfeitSession).not.toHaveBeenCalled();
  });

  it("replaces a daily session stored under the wrong difficulty", async () => {
    localStorage.setItem(
      "touhouflandre:daily-session",
      JSON.stringify({ id: "sess-hard", puzzleKey: "2026-08-05" }),
    );
    vi.mocked(api.catalog).mockResolvedValue({
      dailyDateKey: "2026-08-05",
      contents: [],
    } as never);
    vi.mocked(api.getSession).mockResolvedValue({
      ...sessionWithGuess,
      id: "sess-hard",
      questionScope: {
        ...sessionWithGuess.questionScope,
        difficulty: "hard",
      },
    } as never);
    vi.mocked(api.createPuzzle).mockResolvedValue({
      session: nextDailySession,
      puzzleLabel: "每日题 2026-08-05",
    } as never);

    render(<SingleGamePage mode="daily" />);

    expect(await screen.findByText("0/8")).toBeTruthy();
    expect(localStorage.getItem("touhouflandre:daily-session")).toContain(
      "sess-next-day",
    );
    expect(api.forfeitSession).not.toHaveBeenCalled();
  });

  it("requires confirmation before discarding random progress", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    vi.mocked(api.createPuzzle).mockResolvedValue({
      session: sessionWithGuess,
      puzzleLabel: "随机题",
    } as never);

    render(<SingleGamePage mode="random" />);
    await screen.findByText("1/8");
    const restart = screen.getByLabelText("重新开始随机题");
    expect(restart.classList.contains("paper-button-icon")).toBe(true);
    expect(restart.classList.contains("paper-button-compact")).toBe(false);
    expect(restart.classList.contains("paper-button-theme")).toBe(false);
    expect(restart.dataset.paperVariant).toBe("plain");
    await userEvent.click(restart);

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

  it("uses an interactive compact Paper table for pointer selection", async () => {
    vi.mocked(api.catalog).mockResolvedValue({
      dailyDateKey: "2026-08-05",
      contents: [],
    } as never);
    vi.mocked(api.createPuzzle).mockResolvedValue({
      session: playingSession,
      puzzleLabel: "每日题 2026-08-05",
    } as never);

    const { container } = render(<SingleGamePage mode="daily" />);
    const input = await screen.findByLabelText("搜索东方角色");
    await userEvent.type(input, "帕秋莉");

    const listbox = screen.getByRole("listbox", { name: "搜索建议" });
    const option = within(listbox).getByRole("option", {
      name: /帕秋莉·诺蕾姬/,
    });
    expect(listbox.querySelector(".paper-data-table")).toBeTruthy();
    expect(listbox.querySelector(".paper-data-table-body")).toBeTruthy();
    expect(option.classList.contains("paper-data-table-row")).toBe(true);
    const columns = listbox.querySelector(".suggestion-columns") as HTMLElement;
    expect(columns).toBeTruthy();
    expect(
      columns.parentElement?.classList.contains("suggestion-list-body"),
    ).toBe(true);
    expect(within(columns).getByText("头像")).toBeTruthy();
    expect(within(columns).getByText("角色")).toBeTruthy();
    expect(within(columns).getByText("发色 / 状态")).toBeTruthy();
    expect(option.querySelector(".suggestion-avatar")).toBeTruthy();
    expect(
      container
        .querySelector(".single-game-shell")
        ?.getAttribute("data-suggestions-open"),
    ).toBe("true");

    await userEvent.click(option);
    expect((input as HTMLInputElement).value).toBe("帕秋莉·诺蕾姬");
    expect(
      container
        .querySelector(".single-game-shell")
        ?.getAttribute("data-suggestions-open"),
    ).toBe("false");
  });

  it("prevents hover interaction for already-guessed suggestions", async () => {
    vi.mocked(api.catalog).mockResolvedValue({
      dailyDateKey: "2026-08-05",
      contents: [],
    } as never);
    vi.mocked(api.createPuzzle).mockResolvedValue({
      session: sessionWithGuess,
      puzzleLabel: "每日题 2026-08-05",
    } as never);

    render(<SingleGamePage mode="daily" />);
    const input = await screen.findByLabelText("搜索东方角色");
    await userEvent.type(input, "帕秋莉");

    const option = screen.getByRole("option", {
      name: /帕秋莉·诺蕾姬.*已猜/,
    });
    expect((option as HTMLButtonElement).disabled).toBe(true);
    expect(option.textContent).toContain("已猜");
    await userEvent.click(option);
    expect((input as HTMLInputElement).value).toBe("帕秋莉");
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
  it("restores focus after Enter submits a selected daily guess", async () => {
    vi.mocked(api.catalog).mockResolvedValue({
      dailyDateKey: "2026-08-05",
      contents: [],
    } as never);
    vi.mocked(api.createPuzzle).mockResolvedValue({
      session: playingSession,
      puzzleLabel: "每日题 2026-08-05",
    } as never);
    vi.mocked(api.submitGuess).mockImplementation(async () => {
      (document.activeElement as HTMLElement | null)?.blur();
      return sessionWithGuess as never;
    });

    render(<SingleGamePage mode="daily" />);
    const input = await screen.findByLabelText("搜索东方角色");
    await userEvent.type(input, "帕秋莉");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect((input as HTMLInputElement).value).toBe("帕秋莉·诺蕾姬");

    await userEvent.keyboard("{Enter}");

    await waitFor(() =>
      expect(api.submitGuess).toHaveBeenCalledWith(
        "sess-1",
        "patchouli_knowledge",
        undefined,
      ),
    );
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("restores focus after Enter submits a selected random guess", async () => {
    vi.mocked(api.createPuzzle).mockResolvedValue({
      session: playingSession,
      puzzleLabel: "随机题",
    } as never);
    vi.mocked(api.submitGuess).mockImplementation(async () => {
      (document.activeElement as HTMLElement | null)?.blur();
      return sessionWithGuess as never;
    });

    render(<SingleGamePage mode="random" />);
    const input = await screen.findByLabelText("搜索东方角色");
    await userEvent.type(input, "帕秋莉");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect((input as HTMLInputElement).value).toBe("帕秋莉·诺蕾姬");

    await userEvent.keyboard("{Enter}");

    await waitFor(() =>
      expect(api.submitGuess).toHaveBeenCalledWith(
        "sess-1",
        "patchouli_knowledge",
        undefined,
      ),
    );
    await waitFor(() => expect(document.activeElement).toBe(input));
  });
});
