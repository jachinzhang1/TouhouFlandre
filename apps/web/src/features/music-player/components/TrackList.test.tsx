import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MusicTrack } from "../contracts";
import { TrackList } from "./TrackList";

const firstTrack: MusicTrack = {
  id: "track-one",
  albumId: "album-one",
  trackNumber: 1,
  title: "第一首测试曲目",
  artists: ["第一位作者", "第二位作者"],
  audioUrl: "/music/tracks/test/one.mp3",
  coverUrl: "/music/covers/test.png",
  sourceRefs: ["https://example.com/one"],
};

const secondTrack: MusicTrack = {
  ...firstTrack,
  id: "track-two",
  trackNumber: 2,
  title: "第二首测试曲目",
  artists: ["另一位作者"],
  audioUrl: "/music/tracks/test/two.mp3",
};

describe("TrackList", () => {
  it("renders enabled tracks and exposes the active playback state", () => {
    render(
      <TrackList
        tracks={[firstTrack, secondTrack]}
        currentTrackId={firstTrack.id}
        isPlaying
        onPlayTrack={vi.fn()}
      />,
    );

    const currentItem = document.querySelector(
      `[data-music-player-track-id="${firstTrack.id}"]`,
    );
    expect(currentItem).toHaveAttribute("aria-current", "true");
    expect(currentItem).toHaveClass("is-playing");
    expect(currentItem).toHaveTextContent(firstTrack.title);
    expect(currentItem).toHaveTextContent("第一位作者、第二位作者");
    expect(screen.getByLabelText("正在播放")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `播放《${secondTrack.title}》` }),
    ).toBeInTheDocument();
  });

  it("routes a play button to the selected track and updates with the queue", () => {
    const onPlayTrack = vi.fn();
    const { rerender } = render(
      <TrackList
        tracks={[firstTrack, secondTrack]}
        currentTrackId={firstTrack.id}
        isPlaying={false}
        onPlayTrack={onPlayTrack}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: `播放《${secondTrack.title}》` }),
    );
    expect(onPlayTrack).toHaveBeenCalledWith(secondTrack.id);

    rerender(
      <TrackList
        tracks={[secondTrack]}
        currentTrackId={secondTrack.id}
        isPlaying
        onPlayTrack={onPlayTrack}
      />,
    );
    expect(screen.queryByText(firstTrack.title)).not.toBeInTheDocument();
    expect(screen.getByLabelText("正在播放")).toBeInTheDocument();
  });
});
