"use client";

import { MusicNoteBeamed } from "react-bootstrap-icons";
import type { Ref } from "react";
import type { MusicPlayerStatus } from "./contracts";
import { isUsableDuration } from "./contracts";
import { useMusicPlayer } from "./MusicPlayerProvider";

export const MUSIC_PLAYER_LAUNCHER_SIZE = 48;
export const MUSIC_PLAYER_RING_STROKE = 3;
export const MUSIC_PLAYER_RING_RADIUS =
  (MUSIC_PLAYER_LAUNCHER_SIZE - MUSIC_PLAYER_RING_STROKE) / 2;
export const MUSIC_PLAYER_RING_CIRCUMFERENCE =
  2 * Math.PI * MUSIC_PLAYER_RING_RADIUS;

export type FloatingPlayerButtonProps = {
  isOpen: boolean;
  onToggle: () => void;
  cardId: string;
  buttonRef?: Ref<HTMLButtonElement>;
};

export function clampPlaybackProgress(
  currentTime: number,
  duration: number,
): number {
  if (!isUsableDuration(duration) || !Number.isFinite(currentTime)) return 0;
  return Math.min(1, Math.max(0, currentTime / duration));
}

export function getPlaybackDashOffset(
  currentTime: number,
  duration: number,
): number {
  return (
    MUSIC_PLAYER_RING_CIRCUMFERENCE *
    (1 - clampPlaybackProgress(currentTime, duration))
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function getStatusLabel(status: MusicPlayerStatus): string {
  switch (status) {
    case "loading":
      return "正在加载";
    case "playing":
      return "正在播放";
    case "paused":
      return "已暂停";
    case "error":
      return "播放出错";
    default:
      return "暂无曲目";
  }
}

export function FloatingPlayerButton({
  isOpen,
  onToggle,
  cardId,
  buttonRef,
}: FloatingPlayerButtonProps) {
  const { state } = useMusicPlayer();
  const progress = clampPlaybackProgress(state.currentTime, state.duration);
  const progressPercent = Math.round(progress * 100);
  const statusLabel = state.currentTrack
    ? getStatusLabel(state.status)
    : "暂无曲目";
  const trackLabel = state.currentTrack?.title ?? "暂无曲目";
  const accessibleName = `${isOpen ? "关闭" : "打开"}音乐播放器，${trackLabel}，${statusLabel}`;
  const progressDescription = isUsableDuration(state.duration)
    ? `当前播放进度 ${formatTime(state.currentTime)} / ${formatTime(state.duration)}，${progressPercent}%`
    : "当前播放进度不可用";
  const progressDescriptionId = `${cardId}-progress`;

  return (
    <span className="music-player-launcher-target">
      <button
        type="button"
        ref={buttonRef}
        className="music-player-launcher"
        data-music-player-launcher="true"
        data-status={state.status}
        aria-label={accessibleName}
        aria-expanded={isOpen}
        aria-controls={cardId}
        aria-describedby={progressDescriptionId}
        aria-busy={state.status === "loading"}
        onClick={onToggle}
      >
        <svg
          className="music-player-launcher-ring"
          viewBox={`0 0 ${MUSIC_PLAYER_LAUNCHER_SIZE} ${MUSIC_PLAYER_LAUNCHER_SIZE}`}
          width={MUSIC_PLAYER_LAUNCHER_SIZE}
          height={MUSIC_PLAYER_LAUNCHER_SIZE}
          aria-hidden="true"
          focusable="false"
        >
          <circle
            className="music-player-launcher-ring-progress"
            cx={MUSIC_PLAYER_LAUNCHER_SIZE / 2}
            cy={MUSIC_PLAYER_LAUNCHER_SIZE / 2}
            r={MUSIC_PLAYER_RING_RADIUS}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={MUSIC_PLAYER_RING_STROKE}
            strokeDasharray={MUSIC_PLAYER_RING_CIRCUMFERENCE}
            strokeDashoffset={getPlaybackDashOffset(
              state.currentTime,
              state.duration,
            )}
            strokeLinecap="round"
            transform={`rotate(-90 ${MUSIC_PLAYER_LAUNCHER_SIZE / 2} ${MUSIC_PLAYER_LAUNCHER_SIZE / 2})`}
          />
        </svg>
        <MusicNoteBeamed
          className="music-player-launcher-icon"
          size={22}
          aria-hidden="true"
        />
        <span id={progressDescriptionId} className="sr-only">
          {progressDescription}
        </span>
      </button>
    </span>
  );
}
