import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PublicGameSession } from "@touhoufriberg/shared";
import { SingleGamePage } from "./SingleGamePage";

const playingSession = {
  id: "sess-1",
  status: "playing",
  puzzleKey: "2026-08-05",
  maxGuesses: 8,
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
    names: { zhHans: "帕秋莉·诺蕾姬" },
    avatarUrl: "/characters/0006-帕秋莉·诺蕾姬.png",
  },
} as unknown as PublicGameSession;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../lib/api", () => ({
  api: {
    catalog: vi.fn(),
    getSession: vi.fn(),
    createPuzzle: vi.fn(),
    submitGuess: vi.fn(),
  },
}));

vi.mock("../hooks/useCharacterSearch", () => ({
  useCharacterSearch: () => ({
    results: [
      {
        id: "patchouli_knowledge",
        name: "帕秋莉·诺蕾姬",
        subtitle: "Patchouli Knowledge · 东方红魔乡",
        avatarUrl: "/characters/0006-帕秋莉·诺蕾姬.png",
        initials: "帕秋",
        hairColors: ["purple"],
      },
    ],
    total: 1,
    error: "",
    loading: false,
  }),
}));

import { api } from "../lib/api";

describe("SingleGamePage", () => {
  beforeEach(() => {
    vi.mocked(api.catalog).mockReset();
    vi.mocked(api.createPuzzle).mockReset();
    vi.mocked(api.submitGuess).mockReset();
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
    expect(screen.getByText("0/8")).toBeTruthy();
    expect(screen.getByText("进行中")).toBeTruthy();
    expect(localStorage.getItem("touhoufriberg:daily-session")).toContain(
      "sess-1",
    );
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

    await userEvent.type(
      screen.getByLabelText("搜索东方角色"),
      "帕秋莉",
    );
    await userEvent.click(screen.getByText("帕秋莉·诺蕾姬"));
    await userEvent.click(screen.getByText("提交猜测"));

    expect(await screen.findByText("猜中了")).toBeTruthy();
    expect(screen.getByText(/共使用 1 次猜测/)).toBeTruthy();
  });
});
