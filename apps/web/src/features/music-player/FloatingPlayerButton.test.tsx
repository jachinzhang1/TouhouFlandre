import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MusicPlayerContextValue, MusicTrack } from "./contracts";
import { useMusicPlayer } from "./MusicPlayerProvider";
import {
  clampPlaybackProgress,
  FloatingPlayerButton,
  getPlaybackDashOffset,
  MUSIC_PLAYER_LAUNCHER_SIZE,
  MUSIC_PLAYER_RING_CIRCUMFERENCE,
  MUSIC_PLAYER_RING_RADIUS,
  MUSIC_PLAYER_RING_STROKE,
} from "./FloatingPlayerButton";

vi.mock("./MusicPlayerProvider", () => ({
  useMusicPlayer: vi.fn(),
}));

const useMusicPlayerMock = vi.mocked(useMusicPlayer);

const track: MusicTrack = {
  id: "track-1",
  albumId: "album-1",
  trackNumber: 1,
  title: "测试曲目",
  artists: ["测试艺人"],
  audioUrl: "/music/tracks/test.mp3",
  coverUrl: "/music/covers/test.png",
  sourceRefs: [],
};

function mockPlayer(
  overrides: Partial<MusicPlayerContextValue["state"]> = {},
) {
  const state: MusicPlayerContextValue["state"] = {
    queue: [track],
    currentTrack: track,
    status: "paused",
    isSeeking: false,
    duration: 100,
    currentTime: 25,
    volume: 0.7,
    muted: false,
    error: null,
    ...overrides,
  };
  useMusicPlayerMock.mockReturnValue({
    state,
    commands: {
      play: vi.fn(async () => undefined),
      pause: vi.fn(),
      togglePlayback: vi.fn(async () => undefined),
      playTrack: vi.fn(),
      previous: vi.fn(),
      next: vi.fn(),
      seek: vi.fn(),
      setVolume: vi.fn(),
      toggleMute: vi.fn(),
      applySelection: vi.fn(),
    },
  });
}

describe("floating player progress", () => {
  it("clamps finite progress and keeps invalid durations empty", () => {
    expect(clampPlaybackProgress(25, 100)).toBe(0.25);
    expect(clampPlaybackProgress(-1, 100)).toBe(0);
    expect(clampPlaybackProgress(101, 100)).toBe(1);
    expect(clampPlaybackProgress(1, 0)).toBe(0);
    expect(clampPlaybackProgress(1, Number.NaN)).toBe(0);
    expect(clampPlaybackProgress(1, Number.POSITIVE_INFINITY)).toBe(0);
    expect(getPlaybackDashOffset(0, 100)).toBe(MUSIC_PLAYER_RING_CIRCUMFERENCE);
    expect(getPlaybackDashOffset(100, 100)).toBe(0);
  });
});

describe("FloatingPlayerButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlayer();
  });

  it("keeps a centered music note and exposes current state and progress", () => {
    render(
      <FloatingPlayerButton
        isOpen={false}
        onToggle={vi.fn()}
        cardId="music-player-card"
      />,
    );

    const button = screen.getByRole("button", {
      name: "打开音乐播放器，测试曲目，已暂停",
    });
    expect(button.closest(".music-player-launcher-target")).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("aria-controls", "music-player-card");
    expect(button).toHaveAttribute("aria-describedby", "music-player-card-progress");
    expect(button).toHaveAttribute("data-status", "paused");
    expect(button.querySelector(".bi-music-note-beamed")).toBeTruthy();
    expect(
      button.querySelector(".music-player-launcher-ring-track"),
    ).toBeNull();
    expect(button.querySelector(".music-player-launcher-ring")).toHaveAttribute(
      "viewBox",
      `0 0 ${MUSIC_PLAYER_LAUNCHER_SIZE} ${MUSIC_PLAYER_LAUNCHER_SIZE}`,
    );
    expect(MUSIC_PLAYER_RING_RADIUS + MUSIC_PLAYER_RING_STROKE / 2).toBe(
      MUSIC_PLAYER_LAUNCHER_SIZE / 2,
    );
    expect(button.querySelector(".music-player-launcher-ring-progress")).toHaveAttribute(
      "stroke-dashoffset",
      String(getPlaybackDashOffset(25, 100)),
    );
    expect(screen.getByText("当前播放进度 0:25 / 1:40，25%")).toBeInTheDocument();
  });

  it("toggles through pointer and keyboard activation without changing playback commands", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <FloatingPlayerButton
        isOpen={false}
        onToggle={onToggle}
        cardId="music-player-card"
      />,
    );
    const button = screen.getByRole("button", { name: /打开音乐播放器/ });

    await user.click(button);
    await user.keyboard(" ");
    await user.keyboard("{Enter}");

    expect(onToggle).toHaveBeenCalledTimes(3);
    expect(useMusicPlayerMock).toHaveBeenCalled();
  });

  it("announces loading and handles missing media metadata without invalid styles", () => {
    mockPlayer({
      status: "loading",
      currentTrack: null,
      duration: Number.NaN,
      currentTime: Number.POSITIVE_INFINITY,
    });
    render(
      <FloatingPlayerButton
        isOpen
        onToggle={vi.fn()}
        cardId="music-player-card"
      />,
    );

    const button = screen.getByRole("button", {
      name: "关闭音乐播放器，暂无曲目，暂无曲目",
    });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("data-status", "loading");
    expect(
      button.querySelector(".music-player-launcher-ring-progress"),
    ).toHaveAttribute(
      "stroke-dashoffset",
      String(MUSIC_PLAYER_RING_CIRCUMFERENCE),
    );
    expect(screen.getByText("当前播放进度不可用")).toBeInTheDocument();
  });
});
