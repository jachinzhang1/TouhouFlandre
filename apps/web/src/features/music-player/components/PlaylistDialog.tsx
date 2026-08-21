"use client";

import { Checkbox, ConfigProvider, Modal, Segmented } from "antd";
import { Check, ListMusic, Minus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MUSIC_CATALOG, findMusicAlbum } from "../catalog";
import { useMusicPlayer } from "../MusicPlayerProvider";
import { TrackCover } from "./TrackCover";

type PlaylistDialogProps = {
  open: boolean;
  onClose: () => void;
};

type PlaylistView = "album" | "track";

type AlbumGroup = {
  id: string;
  title: string;
  coverUrl: `/music/covers/${string}`;
  tracks: typeof MUSIC_CATALOG[number][];
};

export function PlaylistDialog({ open, onClose }: PlaylistDialogProps) {
  const { state, commands } = useMusicPlayer();
  const [view, setView] = useState<PlaylistView>("album");
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [validationError, setValidationError] = useState("");

  const albumGroups = useMemo<AlbumGroup[]>(() => {
    const groups = new Map<string, AlbumGroup>();
    for (const track of MUSIC_CATALOG) {
      const album = findMusicAlbum(track.albumId);
      if (!album) continue;
      const group = groups.get(album.id);
      if (group) {
        group.tracks.push(track);
      } else {
        groups.set(album.id, {
          id: album.id,
          title: album.title,
          coverUrl: album.coverUrl,
          tracks: [track],
        });
      }
    }
    return [...groups.values()];
  }, []);

  useEffect(() => {
    if (!open) return;
    setDraft(new Set(state.queue.map((track) => track.id)));
    setView("album");
    setValidationError("");
  }, [open, state.queue]);

  const selectedCount = MUSIC_CATALOG.filter((track) => draft.has(track.id)).length;
  const totalCount = MUSIC_CATALOG.length;
  const emptySelection = selectedCount === 0;

  const setAll = (selected: boolean) => {
    setDraft(
      selected
        ? new Set(MUSIC_CATALOG.map((track) => track.id))
        : new Set(),
    );
    setValidationError("");
  };

  const toggleAlbum = (group: AlbumGroup) => {
    const albumSelected = group.tracks.every((track) => draft.has(track.id));
    setDraft((previous) => {
      const next = new Set(previous);
      for (const track of group.tracks) {
        if (albumSelected) next.delete(track.id);
        else next.add(track.id);
      }
      return next;
    });
    setValidationError("");
  };

  const toggleTrack = (trackId: string, checked: boolean) => {
    setDraft((previous) => {
      const next = new Set(previous);
      if (checked) next.add(trackId);
      else next.delete(trackId);
      return next;
    });
    setValidationError("");
  };

  const apply = () => {
    const selectedIds = MUSIC_CATALOG.filter((track) => draft.has(track.id)).map(
      (track) => track.id,
    );
    if (selectedIds.length === 0) {
      setValidationError("至少选择一首可播放曲目。");
      return;
    }
    commands.applySelection(selectedIds);
    onClose();
  };

  return (
    <ConfigProvider
      theme={{
        token: {
          borderRadius: 5,
          colorBgContainer: "var(--surface)",
          colorBorder: "var(--line)",
          colorPrimary: "var(--vermilion)",
          colorPrimaryBg: "var(--accent-soft)",
          colorPrimaryHover: "var(--vermilion-dark)",
          colorText: "var(--ink)",
          colorTextSecondary: "var(--ink-soft)",
          colorBgElevated: "var(--surface)",
          fontFamily: "var(--font-ui)",
        },
      }}
    >
      <Modal
        open={open}
        centered
        width={760}
        footer={null}
        closable={false}
        mask={{ closable: true }}
        title="调整曲目列表"
        className="music-playlist-modal"
        onCancel={onClose}
      >
        <div className="music-playlist-dialog" data-music-playlist-dialog="true">
          <header className="music-playlist-dialog-header">
            <div>
              <p className="music-playlist-dialog-kicker">
                <ListMusic size={14} aria-hidden="true" />
                曲库设置
              </p>
              <h2 id="music-playlist-dialog-title">调整曲目列表</h2>
              <p className="music-playlist-dialog-count" aria-live="polite">
                已选择 {selectedCount} / {totalCount} 首
              </p>
            </div>
            <button
              type="button"
              className="music-player-icon-button"
              aria-label="关闭曲库设置"
              onClick={onClose}
            >
              <X aria-hidden="true" />
            </button>
          </header>

          <div className="music-playlist-dialog-toolbar">
            <Segmented
              aria-label="曲库显示方式"
              value={view}
              options={[
                { label: "按专辑", value: "album" },
                { label: "按曲目", value: "track" },
              ]}
              onChange={(value) => setView(value as PlaylistView)}
            />
            <div className="music-playlist-dialog-actions" aria-label="曲目选择命令">
              <button type="button" onClick={() => setAll(true)}>
                <Check size={14} aria-hidden="true" />
                全选
              </button>
              <button type="button" onClick={() => setAll(false)}>
                <Minus size={14} aria-hidden="true" />
                全不选
              </button>
            </div>
          </div>

          <div className="music-playlist-dialog-scroll">
            {view === "album" ? (
              <div className="music-playlist-album-grid">
                {albumGroups.map((group) => {
                  const selectedInAlbum = group.tracks.filter((track) =>
                    draft.has(track.id),
                  ).length;
                  const checked = selectedInAlbum === group.tracks.length;
                  const indeterminate = selectedInAlbum > 0 && !checked;
                  return (
                    <Checkbox
                      key={group.id}
                      className="music-playlist-album-card"
                      checked={checked}
                      indeterminate={indeterminate}
                      aria-label={`选择专辑《${group.title}》`}
                      onChange={() => toggleAlbum(group)}
                    >
                      <TrackCover src={group.coverUrl} alt={`《${group.title}》封面`} />
                      <span className="music-playlist-card-copy">
                        <strong>{group.title}</strong>
                        <small>
                          {selectedInAlbum} / {group.tracks.length} 首
                        </small>
                      </span>
                    </Checkbox>
                  );
                })}
              </div>
            ) : (
              <div className="music-playlist-track-grid">
                {MUSIC_CATALOG.map((track) => {
                  const album = findMusicAlbum(track.albumId);
                  return (
                    <Checkbox
                      key={track.id}
                      className="music-playlist-track-card"
                      checked={draft.has(track.id)}
                      aria-label={`选择《${track.title}》`}
                      onChange={(event) => toggleTrack(track.id, event.target.checked)}
                    >
                      <TrackCover src={track.coverUrl} alt={`《${track.title}》封面`} />
                      <span className="music-playlist-card-copy">
                        <strong>{track.title}</strong>
                        <small>{album?.title ?? "未知专辑"}</small>
                        <small>{track.artists.join("、")}</small>
                      </span>
                    </Checkbox>
                  );
                })}
              </div>
            )}
          </div>

          {validationError || emptySelection ? (
            <p className="music-playlist-dialog-error" role="alert">
              {validationError || "至少选择一首可播放曲目。"}
            </p>
          ) : null}

          <footer className="music-playlist-dialog-footer">
            <button
              type="button"
              className="music-playlist-secondary-button"
              onClick={onClose}
            >
              <X size={15} aria-hidden="true" />
              取消
            </button>
            <button
              type="button"
              className="music-playlist-primary-button"
              disabled={emptySelection}
              onClick={apply}
            >
              <Check size={15} aria-hidden="true" />
              应用
            </button>
          </footer>
        </div>
      </Modal>
    </ConfigProvider>
  );
}
