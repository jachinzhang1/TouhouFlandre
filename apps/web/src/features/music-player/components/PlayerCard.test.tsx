import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MusicPlayerCommands,
  MusicPlayerContextValue,
  MusicTrack,
} from "../contracts";
import { useMusicPlayer } from "../MusicPlayerProvider";
import { MarqueeTitle } from "./MarqueeTitle";
import { PlayerCard } from "./PlayerCard";
import { TrackCover } from "./TrackCover";

vi.mock("antd", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  Slider: (props: {
    value: number;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
    onChange?: (value: number) => void;
    onChangeComplete?: (value: number) => void;
    ariaLabelForHandle?: string;
  }) => (
    <input
      type="range"
      value={props.value}
      min={props.min}
      max={props.max}
      step={props.step}
      disabled={props.disabled}
      aria-label={props.ariaLabelForHandle}
      onChange={(event) => props.onChange?.(Number(event.currentTarget.value))}
      onMouseUp={(event) =>
        props.onChangeComplete?.(Number(event.currentTarget.value))
      }
    />
  ),
}));

vi.mock("../MusicPlayerProvider", () => ({
  useMusicPlayer: vi.fn(),
}));

const useMusicPlayerMock = vi.mocked(useMusicPlayer);

const track: MusicTrack = {
  id: "gensoukyoku-bassui-day-06",
  albumId: "gensoukyoku-bassui",
  trackNumber: 6,
  title: "测试曲目",
  artists: ["测试艺人"],
  composer: "测试作曲",
  arranger: "测试编曲",
  audioUrl: "/music/tracks/test/test.mp3",
  coverUrl: "/music/covers/test.png",
  sourceRefs: ["https://example.com/track"],
};

function createCommands(): MusicPlayerCommands {
  return {
    play: vi.fn(async () => undefined),
    pause: vi.fn(),
    togglePlayback: vi.fn(async () => undefined),
    previous: vi.fn(),
    next: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    toggleMute: vi.fn(),
    applySelection: vi.fn(),
  };
}

function mockPlayer(
  overrides: Partial<MusicPlayerContextValue["state"]> = {},
) {
  const state: MusicPlayerContextValue["state"] = {
    queue: [track],
    currentTrack: track,
    status: "paused",
    isSeeking: false,
    duration: 120,
    currentTime: 25,
    volume: 0.7,
    muted: false,
    error: null,
    ...overrides,
  };
  const commands = createCommands();
  useMusicPlayerMock.mockReturnValue({ state, commands });
  return commands;
}

function installMatchMedia(matches = false) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

beforeEach(() => {
  installMatchMedia();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PlayerCard", () => {
  it("renders metadata and routes transport commands through the provider", async () => {
    const user = userEvent.setup();
    const commands = mockPlayer();
    const onOpenPlaylist = vi.fn();

    render(
      <PlayerCard
        open
        cardId="music-player-card"
        onClose={vi.fn()}
        onOpenPlaylist={onOpenPlaylist}
      />,
    );

    expect(screen.getByRole("heading", { name: "测试曲目" })).toBeInTheDocument();
    expect(screen.getByText("测试艺人")).toBeInTheDocument();
    expect(screen.getByText("幻想曲拔萃")).toBeInTheDocument();
    expect(screen.getByAltText("《测试曲目》封面")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "播放" }));
    await user.click(screen.getByRole("button", { name: "上一首" }));
    await user.click(screen.getByRole("button", { name: "下一首" }));
    await user.click(screen.getByRole("button", { name: "曲库设置" }));

    expect(commands.togglePlayback).toHaveBeenCalledTimes(1);
    expect(commands.previous).toHaveBeenCalledTimes(1);
    expect(commands.next).toHaveBeenCalledTimes(1);
    expect(onOpenPlaylist).toHaveBeenCalledTimes(1);
  });

  it("keeps a seek draft until the slider commit", () => {
    const commands = mockPlayer();
    render(
      <PlayerCard
        open
        cardId="music-player-card"
        onClose={vi.fn()}
        onOpenPlaylist={vi.fn()}
      />,
    );

    const slider = screen.getByRole("slider", { name: "播放进度" });
    fireEvent.change(slider, { target: { value: "48" } });
    expect(commands.seek).not.toHaveBeenCalled();
    expect(slider).toHaveValue("48");

    fireEvent.mouseUp(slider, { target: { value: "48" } });
    expect(commands.seek).toHaveBeenCalledTimes(1);
    expect(commands.seek).toHaveBeenCalledWith(48);
  });

  it("maps volume changes and mute clicks to provider commands", async () => {
    const user = userEvent.setup();
    const commands = mockPlayer();
    render(
      <PlayerCard
        open
        cardId="music-player-card"
        onClose={vi.fn()}
        onOpenPlaylist={vi.fn()}
      />,
    );

    const volume = screen.getByRole("slider", { name: "音量" });
    fireEvent.change(volume, { target: { value: "0.34" } });
    await user.click(screen.getByRole("button", { name: "静音" }));

    expect(commands.setVolume).toHaveBeenCalledWith(0.34);
    expect(commands.toggleMute).toHaveBeenCalledTimes(1);
  });

  it("keeps a stable playback target while media is loading", () => {
    mockPlayer({ status: "loading" });
    render(
      <PlayerCard
        open
        cardId="music-player-card"
        onClose={vi.fn()}
        onOpenPlaylist={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "播放" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByText("正在加载")).toBeInTheDocument();
    expect(document.querySelector(".music-player-loading-icon")).toBeInTheDocument();
  });

  it("falls back from a broken cover to the placeholder and then a stable icon", () => {
    mockPlayer();
    render(
      <PlayerCard
        open
        cardId="music-player-card"
        onClose={vi.fn()}
        onOpenPlaylist={vi.fn()}
      />,
    );

    const image = screen.getByAltText("《测试曲目》封面");
    fireEvent.error(image);
    expect(screen.getByAltText("《测试曲目》封面")).toHaveAttribute(
      "src",
      "/music/placeholder-cover.png",
    );
    fireEvent.error(screen.getByAltText("《测试曲目》封面"));
    expect(screen.getByRole("img", { name: "《测试曲目》封面" })).toBeInTheDocument();
  });

  it("resets cover fallback state when the track changes", () => {
    const { rerender } = render(
      <TrackCover src="/music/covers/first.png" alt="第一首封面" />,
    );
    fireEvent.error(screen.getByAltText("第一首封面"));
    expect(screen.getByAltText("第一首封面")).toHaveAttribute(
      "src",
      "/music/placeholder-cover.png",
    );

    rerender(<TrackCover src="/music/covers/second.png" alt="第二首封面" />);
    expect(screen.getByAltText("第二首封面")).toHaveAttribute(
      "src",
      "/music/covers/second.png",
    );
  });

  it("exposes errors and disables seeking when duration is unavailable", () => {
    mockPlayer({
      status: "error",
      duration: Number.NaN,
      currentTime: Number.NaN,
      error: "音频无法解码。",
    });
    const { container } = render(
      <PlayerCard
        open
        cardId="music-player-card"
        onClose={vi.fn()}
        onOpenPlaylist={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("音频无法解码。");
    expect(screen.getByText("--:--")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "播放进度" })).toBeDisabled();
    expect(container.querySelector("[data-music-player-card]")).toHaveAttribute(
      "aria-hidden",
      "false",
    );
  });

  it("keeps closed card content inert and out of the accessibility tree", () => {
    mockPlayer();
    const { container } = render(
      <PlayerCard
        open={false}
        cardId="music-player-card"
        onClose={vi.fn()}
        onOpenPlaylist={vi.fn()}
      />,
    );

    const card = container.querySelector("[data-music-player-card]");
    expect(card).toHaveAttribute("aria-hidden", "true");
    expect(card).toHaveAttribute("inert");
  });
});

describe("MarqueeTitle", () => {
  it("only renders the scrolling duplicate when the title overflows", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(240);

    render(<MarqueeTitle>很长很长的测试曲目标题</MarqueeTitle>);

    await waitFor(() =>
      expect(document.querySelector(".is-scrolling")).toBeInTheDocument(),
    );
    expect(screen.getAllByText("很长很长的测试曲目标题")).toHaveLength(2);
  });

  it("does not auto-scroll when reduced motion is enabled", () => {
    installMatchMedia(true);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(240);

    render(<MarqueeTitle>很长很长的测试曲目标题</MarqueeTitle>);

    expect(document.querySelector(".is-scrolling")).not.toBeInTheDocument();
    expect(screen.getAllByText("很长很长的测试曲目标题")).toHaveLength(1);
  });
});
