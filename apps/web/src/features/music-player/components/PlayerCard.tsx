"use client";

import { Slider, Tooltip } from "antd";
import {
  ArrowRepeat,
  GearFill,
  MusicNoteList,
  PauseFill,
  PlayFill,
  SkipBackwardFill,
  SkipForwardFill,
  VolumeDownFill,
  VolumeMuteFill,
  VolumeOffFill,
  VolumeUpFill,
} from "react-bootstrap-icons";
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
import { TrackList } from "./TrackList";

export type PlayerCardProps = {
  open: boolean;
  cardId: string;
  onOpenPlaylist: () => void;
  playlistSettingsButtonRef?: RefObject<HTMLButtonElement | null>;
};

function formatTime(seconds: number, unknown = "--:--"): string {
  if (!Number.isFinite(seconds) || seconds < 0) return unknown;
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function sliderValue(value: number | number[]): number {
  return Array.isArray(value) ? (value[0] ?? 0) : value;
}

function getStatusText(status: MusicPlayerStatus): string | null {
  return status === "loading" ? "正在加载" : null;
}

function VolumeIcon({
  level,
}: {
  level: ReturnType<typeof getVolumeIconLevel>;
}) {
  if (level === "muted") return <VolumeMuteFill aria-hidden="true" />;
  if (level === "low") return <VolumeOffFill aria-hidden="true" />;
  if (level === "medium") return <VolumeDownFill aria-hidden="true" />;
  return <VolumeUpFill aria-hidden="true" />;
}

export function PlayerCard({
  open,
  cardId,
  onOpenPlaylist,
  playlistSettingsButtonRef,
}: PlayerCardProps) {
  const { state, commands } = useMusicPlayer();
  const [isTrackListOpen, setIsTrackListOpen] = useState(false);
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
  const volumeLevel = getVolumeIconLevel(state.volume, state.muted);
  const isPlaying = state.status === "playing";
  const hasTrack = Boolean(currentTrack);
  const statusText = getStatusText(state.status);
  const statusMessage = state.error ?? statusText;
  const trackListId = `${cardId}-track-list`;

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
      aria-describedby={statusMessage ? `${cardId}-status` : undefined}
      inert={!open ? true : undefined}
    >
      <Tooltip title="曲库设置">
        <button
          type="button"
          className="music-player-card-settings-button"
          aria-label="曲库设置"
          aria-haspopup="dialog"
          onClick={onOpenPlaylist}
          ref={playlistSettingsButtonRef}
        >
          <GearFill aria-hidden="true" />
        </button>
      </Tooltip>
      <div className="music-player-card-summary">
        <TrackCover src={currentTrack?.coverUrl} alt={`《${title}》封面`} />
        <div className="music-player-card-details">
          <h2 id={`${cardId}-title`} className="music-player-card-title">
            <MarqueeTitle>{title}</MarqueeTitle>
          </h2>
          <p className="music-player-card-meta">{artist}</p>
          <p className="music-player-card-meta">{album?.title ?? "未知专辑"}</p>
          {credits ? (
            <p className="music-player-card-credits">{credits}</p>
          ) : null}
        </div>
      </div>

      <div className="music-player-card-progress" aria-live="off">
        <span>{formatTime(displayedTime, "0:00")}</span>
        <Slider
          min={0}
          max={durationIsUsable ? state.duration : 1}
          step={0.1}
          value={durationIsUsable ? displayedTime : 0}
          disabled={!hasTrack || !durationIsUsable}
          ariaLabelForHandle="播放进度"
          tooltip={{ open: false }}
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
        <span>{formatTime(state.duration)}</span>
      </div>

      <div className="music-player-controls" aria-label="播放控制">
        <Tooltip title={isTrackListOpen ? "收起曲目列表" : "曲目列表"}>
          <button
            type="button"
            className="music-player-icon-button music-player-playlist-button"
            aria-label="曲目列表"
            aria-expanded={isTrackListOpen}
            aria-controls={trackListId}
            onClick={() => setIsTrackListOpen((open) => !open)}
          >
            <MusicNoteList aria-hidden="true" />
          </button>
        </Tooltip>
        <Tooltip title="上一首">
          <button
            type="button"
            className="music-player-icon-button"
            aria-label="上一首"
            disabled={!hasTrack}
            onClick={() => commands.previous()}
          >
            <SkipBackwardFill aria-hidden="true" />
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
              <ArrowRepeat
                className="music-player-loading-icon"
                aria-hidden="true"
              />
            ) : isPlaying ? (
              <PauseFill aria-hidden="true" />
            ) : (
              <PlayFill aria-hidden="true" />
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
            <SkipForwardFill aria-hidden="true" />
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
            tooltip={{ open: false }}
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

      {statusMessage ? (
        <p
          id={`${cardId}-status`}
          className="music-player-status"
          role={state.error ? "alert" : "status"}
        >
          {statusMessage}
        </p>
      ) : null}

      <div
        id={trackListId}
        className="music-player-track-list-panel"
        data-open={isTrackListOpen}
        aria-hidden={!isTrackListOpen}
        inert={!isTrackListOpen ? true : undefined}
      >
        <div className="music-player-track-list-clip">
          <TrackList
            tracks={state.queue}
            currentTrackId={currentTrack?.id}
            isPlaying={isPlaying}
            onPlayTrack={commands.playTrack}
          />
        </div>
      </div>
    </section>
  );
}
