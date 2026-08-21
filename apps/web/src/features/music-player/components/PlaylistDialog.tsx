"use client";

import { Checkbox, ConfigProvider, Modal, Segmented } from "antd";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ListMusic,
  Minus,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MUSIC_CATALOG, findMusicAlbum } from "../catalog";
import type { MusicAlbum } from "../contracts";
import { useMusicPlayer } from "../MusicPlayerProvider";
import { TrackCover } from "./TrackCover";

type PlaylistDialogProps = {
  open: boolean;
  onClose: () => void;
};

type PlaylistView = "album" | "track";

type AlbumGroup = {
  id: string;
  category: MusicAlbum["category"];
  title: string;
  coverUrl: `/music/covers/${string}`;
  tracks: typeof MUSIC_CATALOG[number][];
};

type AlbumCategoryGroup = {
  id: MusicAlbum["category"];
  title: string;
  albums: AlbumGroup[];
};

const ALBUM_CATEGORY_ORDER: readonly MusicAlbum["category"][] = [
  "game_ost",
  "zun_music_cd",
  "tasofro_game_ost",
];

const ALBUM_CATEGORY_LABELS: Record<MusicAlbum["category"], string> = {
  game_ost: "游戏原声带",
  zun_music_cd: "ZUN的音乐CD",
  tasofro_game_ost: "黄昏边境合作游戏OST",
};

export function PlaylistDialog({ open, onClose }: PlaylistDialogProps) {
  const { state, commands } = useMusicPlayer();
  const [view, setView] = useState<PlaylistView>("album");
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    new Set(),
  );
  const [collapsedAlbums, setCollapsedAlbums] = useState<Set<string>>(
    new Set(),
  );
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
          category: album.category,
          title: album.title,
          coverUrl: album.coverUrl,
          tracks: [track],
        });
      }
    }
    return [...groups.values()];
  }, []);

  const albumCategoryGroups = useMemo<AlbumCategoryGroup[]>(() => {
    const groups = new Map<MusicAlbum["category"], AlbumCategoryGroup>();
    for (const category of ALBUM_CATEGORY_ORDER) {
      groups.set(category, {
        id: category,
        title: ALBUM_CATEGORY_LABELS[category],
        albums: [],
      });
    }
    for (const album of albumGroups) {
      groups.get(album.category)?.albums.push(album);
    }
    return [...groups.values()].filter((group) => group.albums.length > 0);
  }, [albumGroups]);

  useEffect(() => {
    if (!open) return;
    setDraft(new Set(state.queue.map((track) => track.id)));
    setView("album");
    setCollapsedCategories(new Set());
    setCollapsedAlbums(new Set());
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

  const toggleCategoryCollapsed = (category: string) => {
    setCollapsedCategories((previous) => {
      const next = new Set(previous);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const toggleAlbumCollapsed = (albumId: string) => {
    setCollapsedAlbums((previous) => {
      const next = new Set(previous);
      if (next.has(albumId)) next.delete(albumId);
      else next.add(albumId);
      return next;
    });
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
        width={1040}
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
              className="music-playlist-dialog-close"
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
              <div className="music-playlist-section-list">
                {albumCategoryGroups.map((category) => {
                  const collapsed = collapsedCategories.has(category.id);
                  return (
                    <section
                      key={category.id}
                      className="music-playlist-section"
                      data-music-playlist-category={category.id}
                    >
                      <button
                        type="button"
                        className="music-playlist-section-toggle"
                        aria-expanded={!collapsed}
                        aria-controls={`music-playlist-category-${category.id}`}
                        onClick={() => toggleCategoryCollapsed(category.id)}
                      >
                        {collapsed ? (
                          <ChevronRight size={17} aria-hidden="true" />
                        ) : (
                          <ChevronDown size={17} aria-hidden="true" />
                        )}
                        <span>{category.title}</span>
                        <small>{category.albums.length} 张专辑</small>
                      </button>
                      {!collapsed ? (
                        <div
                          id={`music-playlist-category-${category.id}`}
                          className="music-playlist-album-grid"
                        >
                          {category.albums.map((group) => {
                            const selectedInAlbum = group.tracks.filter((track) =>
                              draft.has(track.id),
                            ).length;
                            const checked = selectedInAlbum === group.tracks.length;
                            const indeterminate = selectedInAlbum > 0 && !checked;
                            return (
                              <Checkbox
                                key={group.id}
                                className={`music-playlist-album-card${
                                  checked || indeterminate ? " is-selected" : ""
                                }`}
                                checked={checked}
                                indeterminate={indeterminate}
                                aria-label={`选择专辑《${group.title}》`}
                                onChange={() => toggleAlbum(group)}
                              >
                                <TrackCover
                                  src={group.coverUrl}
                                  alt={`《${group.title}》封面`}
                                />
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
                      ) : null}
                    </section>
                  );
                })}
              </div>
            ) : (
              <div className="music-playlist-section-list">
                {albumGroups.map((group) => {
                  const collapsed = collapsedAlbums.has(group.id);
                  return (
                    <section
                      key={group.id}
                      className="music-playlist-section"
                      data-music-playlist-album={group.id}
                    >
                      <button
                        type="button"
                        className="music-playlist-section-toggle"
                        aria-expanded={!collapsed}
                        aria-controls={`music-playlist-album-${group.id}`}
                        onClick={() => toggleAlbumCollapsed(group.id)}
                      >
                        {collapsed ? (
                          <ChevronRight size={17} aria-hidden="true" />
                        ) : (
                          <ChevronDown size={17} aria-hidden="true" />
                        )}
                        <span>{group.title}</span>
                        <small>{group.tracks.length} 首曲目</small>
                      </button>
                      {!collapsed ? (
                        <div
                          id={`music-playlist-album-${group.id}`}
                          className="music-playlist-track-grid"
                        >
                          {group.tracks.map((track) => (
                            <Checkbox
                              key={track.id}
                              className={`music-playlist-track-card${
                                draft.has(track.id) ? " is-selected" : ""
                              }`}
                              checked={draft.has(track.id)}
                              aria-label={`选择《${track.title}》`}
                              onChange={(event) =>
                                toggleTrack(track.id, event.target.checked)
                              }
                            >
                              <TrackCover
                                src={track.coverUrl}
                                alt={`《${track.title}》封面`}
                              />
                              <span className="music-playlist-card-copy">
                                <strong>{track.title}</strong>
                                <small>{group.title}</small>
                                <small>{track.artists.join("、")}</small>
                              </span>
                            </Checkbox>
                          ))}
                        </div>
                      ) : null}
                    </section>
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
