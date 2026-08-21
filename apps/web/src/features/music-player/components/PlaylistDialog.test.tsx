import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MUSIC_CATALOG, findMusicAlbum } from "../catalog";
import type { MusicPlayerContextValue } from "../contracts";
import { useMusicPlayer } from "../MusicPlayerProvider";
import { PlaylistDialog } from "./PlaylistDialog";

vi.mock("antd", () => ({
  ConfigProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Modal: ({
    open,
    children,
  }: {
    open: boolean;
    children: ReactNode;
  }) => (open ? <div role="dialog">{children}</div> : null),
  Segmented: ({
    value,
    options,
    onChange,
  }: {
    value: string;
    options: { label: string; value: string }[];
    onChange: (value: string) => void;
  }) => (
    <select aria-label="曲库显示方式" value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  Checkbox: ({
    checked,
    indeterminate,
    onChange,
    children,
    className,
    ...props
  }: {
    checked?: boolean;
    indeterminate?: boolean;
    onChange?: (event: { target: { checked: boolean } }) => void;
    children?: ReactNode;
    className?: string;
    "aria-label"?: string;
  }) => (
    <label className={className}>
      <input
        type="checkbox"
        checked={Boolean(checked)}
        data-indeterminate={indeterminate ? "true" : "false"}
        aria-label={props["aria-label"]}
        onChange={(event) => onChange?.({ target: { checked: event.target.checked } })}
      />
      {children}
    </label>
  ),
}));

vi.mock("../MusicPlayerProvider", () => ({
  useMusicPlayer: vi.fn(),
}));

const useMusicPlayerMock = vi.mocked(useMusicPlayer);

function createPlayer(): {
  context: MusicPlayerContextValue;
  applySelection: ReturnType<typeof vi.fn>;
} {
  const applySelection = vi.fn();
  const commands = {
    play: vi.fn(async () => undefined),
    pause: vi.fn(),
    togglePlayback: vi.fn(async () => undefined),
    previous: vi.fn(),
    next: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    toggleMute: vi.fn(),
    applySelection,
  } as MusicPlayerContextValue["commands"];
  return {
    applySelection,
    context: {
      state: {
        queue: MUSIC_CATALOG,
        currentTrack: MUSIC_CATALOG[0],
        status: "paused",
        isSeeking: false,
        duration: 0,
        currentTime: 0,
        volume: 0.7,
        muted: false,
        error: null,
      },
      commands,
    },
  };
}

describe("PlaylistDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shares one draft between album and track views and applies canonical IDs", () => {
    const player = createPlayer();
    useMusicPlayerMock.mockReturnValue(player.context);
    render(<PlaylistDialog open onClose={vi.fn()} />);

    const view = screen.getByRole("combobox", { name: "曲库显示方式" });
    fireEvent.change(view, { target: { value: "track" } });
    const trackCheckbox = screen.getByRole("checkbox", {
      name: `选择《${MUSIC_CATALOG[0].title}》`,
    });
    fireEvent.click(trackCheckbox);

    fireEvent.change(view, { target: { value: "album" } });
    expect(
      screen.getByRole("checkbox", {
        name: `选择专辑《${findMusicAlbum(MUSIC_CATALOG[0].albumId)?.title}》`,
      }),
    ).toHaveAttribute("data-indeterminate", "true");

    fireEvent.click(screen.getByRole("button", { name: /应用/ }));
    expect(player.applySelection).toHaveBeenCalledTimes(1);
    expect(player.applySelection).toHaveBeenCalledWith(
      MUSIC_CATALOG.slice(1).map((track) => track.id),
    );
  });

  it("disables Apply and explains the empty selection", () => {
    const player = createPlayer();
    useMusicPlayerMock.mockReturnValue(player.context);
    render(<PlaylistDialog open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /全不选/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("至少选择一首");
    expect(screen.getByRole("button", { name: /应用/ })).toBeDisabled();
    expect(player.applySelection).not.toHaveBeenCalled();
  });

  it("cancels without applying the draft", () => {
    const onClose = vi.fn();
    const player = createPlayer();
    useMusicPlayerMock.mockReturnValue(player.context);
    render(<PlaylistDialog open onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /取消/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(player.applySelection).not.toHaveBeenCalled();
  });

  it("separates album categories and collapses category and album sections", () => {
    const player = createPlayer();
    useMusicPlayerMock.mockReturnValue(player.context);
    render(<PlaylistDialog open onClose={vi.fn()} />);

    const gameSection = document.querySelector(
      '[data-music-playlist-category="game_ost"]',
    );
    expect(gameSection).not.toBeNull();
    const gameToggle = within(gameSection as HTMLElement).getByRole("button", {
      name: /游戏原声带/u,
    });
    expect(gameToggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(gameToggle);
    expect(gameToggle).toHaveAttribute("aria-expanded", "false");
    expect(
      within(gameSection as HTMLElement).queryByRole("checkbox", {
        name: "选择专辑《东方红魔乡》",
      }),
    ).toBeNull();

    const view = screen.getByRole("combobox", { name: "曲库显示方式" });
    fireEvent.change(view, { target: { value: "track" } });
    const gameAlbum = document.querySelector(
      '[data-music-playlist-album="th06"]',
    );
    expect(gameAlbum).not.toBeNull();
    const albumToggle = within(gameAlbum as HTMLElement).getByRole("button", {
      name: /东方红魔乡/u,
    });
    fireEvent.click(albumToggle);
    expect(albumToggle).toHaveAttribute("aria-expanded", "false");
    expect(
      within(gameAlbum as HTMLElement).queryByRole("checkbox", {
        name: `选择《${MUSIC_CATALOG[0].title}》`,
      }),
    ).toBeNull();
  });

  it("updates card emphasis immediately when a track is unchecked", () => {
    const player = createPlayer();
    useMusicPlayerMock.mockReturnValue(player.context);
    render(<PlaylistDialog open onClose={vi.fn()} />);

    const checkbox = screen.getByRole("checkbox", {
      name: `选择专辑《${findMusicAlbum(MUSIC_CATALOG[0].albumId)?.title}》`,
    });
    const card = checkbox.closest("label");
    expect(card).toHaveClass("is-selected");
    fireEvent.click(checkbox);
    expect(card).not.toHaveClass("is-selected");
  });
});
