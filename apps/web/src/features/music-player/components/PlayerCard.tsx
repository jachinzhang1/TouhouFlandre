"use client";

import { Slider, Tooltip } from "antd";
import {
  ListMusic,
  LoaderCircle,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  clampMediaTime,
  getVolumeIconLevel,
  isUsableDuration,
  type MusicPlayerStatus,
} from "../contracts";
import { findMusicAlbum } from "../catalog";
import { useMusicPlayer } from "../MusicPlayerProvider";
import { MarqueeTitle } from "./MarqueeTitle";
import { TrackCover } from "./TrackCover";

export type PlayerCardProps = {
  open: boolean;
  cardId: string;
  onClose: () => void;
  onOpenPlaylist: () => void;
  playlistButtonRef?: RefObject<HTMLButtonElement | null>;
};

function formatTime(seconds: number, unknown = "--:--"): string {
  if (!Number.isFinite(seconds) || seconds < 0) return unknown;
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function sliderValue(value: number | number[]): number {
  return Array.isArray(value) ? value[0] ?? 0 : value;
}

function getStatusText(status: MusicPlayerStatus): string {
  switch (status) {
    case "loading":
      return "正在加载";
    case "playing":
      return "正在播放";
    case "error":
      return "播放出错";
    case "paused":
      return "已暂停";
    default:
      return "暂无曲目";
  }
}

function VolumeIcon({ level }: { level: ReturnType<typeof getVolumeIconLevel> }) {
  if (level === "muted") return <VolumeX aria-hidden="true" />;
  if (level === "low") return <Volume aria-hidden="true" />;
  if (level === "medium") return <Volume1 aria-hidden="true" />;
  return <Volume2 aria-hidden="true" />;
}

export function PlayerCard({
  open,
  cardId,
  onClose,
  onOpenPlaylist,
  playlistButtonRef,
}: PlayerCardProps) {
  const { state, commands } = useMusicPlayer();
  const currentTrack = state.currentTrack;
  const album = useMemo(
    () => findMusicAlbum(currentTrack?.albumId),
    [currentTrack?.albumId],
  );
  const durationIsUsable = isUsableDuration(state.duration);
  const [seekDraft, setSeekDraft] = useState(0);
  const [isSeekDraft, setIsSeekDraft] = useState(false);
  const committedSeekRef = useRef<number | null>(null);
  const committedSeekTrackRef = useRef<string | null>(null);

  useEffect(() => {
    if (isSeekDraft) return;
    if (committedSeekRef.current !== null) {
      if (
        committedSeekTrackRef.current === currentTrack?.id &&
        Math.abs(state.currentTime - committedSeekRef.current) > 0.5
      ) {
        return;
      }
      committedSeekRef.current = null;
      committedSeekTrackRef.current = null;
    }
    setSeekDraft(clampMediaTime(state.currentTime, state.duration));
  }, [
    currentTrack?.id,
    isSeekDraft,
    state.currentTime,
    state.currentTrack?.id,
    state.duration,
  ]);

  const displayedTime = isSeekDraft ? seekDraft : state.currentTime;
  const title = currentTrack?.title ?? "暂无曲目";
  const artist = currentTrack?.artists.join("、") || "未知艺人";
  const credits = [
    currentTrack?.composer ? `作曲：${currentTrack.composer}` : null,
    currentTrack?.arranger ? `编曲：${currentTrack.arranger}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const statusText = getStatusText(state.status);
  const volumeLevel = getVolumeIconLevel(state.volume, state.muted);
  const isPlaying = state.status === "playing";
  const hasTrack = Boolean(currentTrack);

  const commitSeek = (value: number | number[]) => {
    const next = sliderValue(value);
    committedSeekRef.current = next;
    committedSeekTrackRef.current = currentTrack?.id ?? null;
    setSeekDraft(next);
    setIsSeekDraft(false);
    if (durationIsUsable) commands.seek(next);
  };

  return (
    <section
      id={cardId}
      className="music-player-card"
      data-music-player-card="true"
      data-open={open}
      aria-hidden={!open}
      aria-labelledby={`${cardId}-title`}
      aria-describedby={`${cardId}-status`}
      inert={!open ? true : undefined}
    >
      <div className="music-player-card-header">
        <span className="music-player-card-kicker">音乐播放器</span>
        <Tooltip title="关闭音乐播放器">
          <button
            type="button"
            className="music-player-icon-button"
            aria-label="关闭音乐播放器"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </Tooltip>
      </div>

      <div className="music-player-card-summary">
        <TrackCover src={currentTrack?.coverUrl} alt={`《${title}》封面`} />
        <div className="music-player-card-details">
          <h2 id={`${cardId}-title`} className="music-player-card-title">
            <MarqueeTitle>{title}</MarqueeTitle>
          </h2>
          <p className="music-player-card-meta">{artist}</p>
          <p className="music-player-card-meta">
            {album?.title ?? "未知专辑"}
          </p>
          {credits ? <p className="music-player-card-credits">{credits}</p> : null}
        </div>
      </div>

      <div className="music-player-card-progress">
        <Slider
          min={0}
          max={durationIsUsable ? state.duration : 1}
          step={0.1}
          value={durationIsUsable ? displayedTime : 0}
          disabled={!hasTrack || !durationIsUsable}
          ariaLabelForHandle="播放进度"
          styles={{
            track: { backgroundColor: "var(--accent)" },
            rail: { backgroundColor: "var(--line-strong)" },
            handle: { borderColor: "var(--accent)" },
          }}
          onChange={(value) => {
            setIsSeekDraft(true);
            setSeekDraft(sliderValue(value));
          }}
          onChangeComplete={commitSeek}
        />
        <div className="music-player-time-row" aria-live="off">
          <span>{formatTime(displayedTime, "0:00")}</span>
          <span>{formatTime(state.duration)}</span>
        </div>
      </div>

      <div className="music-player-transport" aria-label="播放控制">
        <Tooltip title="上一首">
          <button
            type="button"
            className="music-player-icon-button"
            aria-label="上一首"
            disabled={!hasTrack}
            onClick={() => commands.previous()}
          >
            <SkipBack aria-hidden="true" />
          </button>
        </Tooltip>
        <Tooltip title={isPlaying ? "暂停" : "播放"}>
          <button
            type="button"
            className="music-player-play-button"
            aria-label={isPlaying ? "暂停" : "播放"}
            aria-pressed={isPlaying}
            aria-busy={state.status === "loading"}
            disabled={!hasTrack}
            onClick={() => void commands.togglePlayback()}
          >
            {state.status === "loading" ? (
              <LoaderCircle className="music-player-loading-icon" aria-hidden="true" />
            ) : isPlaying ? (
              <Pause aria-hidden="true" />
            ) : (
              <Play aria-hidden="true" />
            )}
          </button>
        </Tooltip>
        <Tooltip title="下一首">
          <button
            type="button"
            className="music-player-icon-button"
            aria-label="下一首"
            disabled={!hasTrack}
            onClick={() => commands.next()}
          >
            <SkipForward aria-hidden="true" />
          </button>
        </Tooltip>
      </div>

      <p id={`${cardId}-status`} className="music-player-status" role={state.error ? "alert" : "status"}>
        {state.error ?? statusText}
      </p>

      <div className="music-player-card-footer">
        <Tooltip title="曲库设置">
          <button
            type="button"
            className="music-player-icon-button"
            aria-label="曲库设置"
            onClick={onOpenPlaylist}
            ref={playlistButtonRef}
          >
            <ListMusic aria-hidden="true" />
          </button>
        </Tooltip>
        <div className="music-player-volume-control">
          <Tooltip title={state.muted ? "取消静音" : "静音"}>
            <button
              type="button"
              className="music-player-icon-button"
              aria-label={state.muted ? "取消静音" : "静音"}
              onClick={() => commands.toggleMute()}
            >
              <VolumeIcon level={volumeLevel} />
            </button>
          </Tooltip>
          <Slider
            min={0}
            max={1}
            step={0.01}
            value={state.volume}
            ariaLabelForHandle="音量"
            styles={{
              track: { backgroundColor: "var(--accent)" },
              rail: { backgroundColor: "var(--line-strong)" },
              handle: { borderColor: "var(--accent)" },
            }}
            onChange={(value) => commands.setVolume(sliderValue(value))}
          />
          <span className="music-player-volume-value" aria-hidden="true">
            {Math.round(state.volume * 100)}%
          </span>
        </div>
      </div>
    </section>
  );
}
