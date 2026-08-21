"use client";

import { PlayFill, Soundwave } from "react-bootstrap-icons";
import type { MusicTrack } from "../contracts";
import { MarqueeTitle } from "./MarqueeTitle";

export type TrackListProps = {
  tracks: readonly MusicTrack[];
  currentTrackId?: string;
  isPlaying: boolean;
  onPlayTrack: (trackId: string) => void;
};

export function TrackList({
  tracks,
  currentTrackId,
  isPlaying,
  onPlayTrack,
}: TrackListProps) {
  return (
    <ul className="music-player-track-list" aria-label="启用的曲目">
      {tracks.map((track) => {
        const isCurrent = track.id === currentTrackId;
        const isActive = isCurrent && isPlaying;
        const artist = track.artists.join("、") || "未知艺人";

        return (
          <li
            key={track.id}
            className={`music-player-track-list-item${
              isCurrent ? " is-current" : ""
            }${isActive ? " is-playing" : ""}`}
            data-music-player-track-id={track.id}
            aria-current={isCurrent ? "true" : undefined}
          >
            <div className="music-player-track-list-copy">
              <MarqueeTitle
                behavior="hover"
                className="music-player-track-list-title"
              >
                {track.title}
              </MarqueeTitle>
              <span className="music-player-track-list-artist">{artist}</span>
            </div>
            <div className="music-player-track-list-action">
              {isActive ? (
                <span
                  className="music-player-track-playing-icon"
                  aria-label="正在播放"
                >
                  <Soundwave aria-hidden="true" />
                </span>
              ) : (
                <button
                  type="button"
                  className="music-player-track-play-button"
                  aria-label={`播放《${track.title}》`}
                  onClick={() => onPlayTrack(track.id)}
                >
                  <PlayFill aria-hidden="true" />
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
