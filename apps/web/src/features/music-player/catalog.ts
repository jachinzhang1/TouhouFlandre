import {
  demoMusicAlbums,
  demoMusicTracks,
  resolveMusicCoverUrl,
} from "@touhouflandre/data/music";
import type { MusicAlbum as CatalogMusicAlbum } from "@touhouflandre/data/music";
import type { MusicAlbum, MusicTrack } from "./contracts";

const albumsById = new Map<string, CatalogMusicAlbum>(
  demoMusicAlbums.map((album) => [album.id, album]),
);
const orderedTracks = [...demoMusicTracks].sort(
  (left, right) =>
    (albumsById.get(left.albumId)?.order ?? Number.MAX_SAFE_INTEGER) -
      (albumsById.get(right.albumId)?.order ?? Number.MAX_SAFE_INTEGER) ||
    left.trackNumber - right.trackNumber ||
    left.id.localeCompare(right.id),
);

/** The feature consumes a resolved, immutable queue rather than raw catalog rows. */
export const MUSIC_CATALOG: readonly MusicTrack[] = orderedTracks.map(
  (track) => {
    const album = albumsById.get(track.albumId);
    if (!album) throw new Error(`Music track has no album: ${track.id}`);
    return {
      ...track,
      coverUrl: resolveMusicCoverUrl(track, album),
    };
  },
);

const catalogById = new Map(MUSIC_CATALOG.map((track) => [track.id, track]));

export function findMusicAlbum(albumId: string | undefined): MusicAlbum | null {
  return albumId ? (albumsById.get(albumId) ?? null) : null;
}

export function normalizeMusicSelection(
  trackIds: readonly string[] | undefined,
): MusicTrack[] {
  if (!trackIds) return [...MUSIC_CATALOG];
  const selectedIds = new Set(trackIds);
  return MUSIC_CATALOG.filter((track) => selectedIds.has(track.id));
}

export function findMusicTrack(trackId: string | undefined): MusicTrack | null {
  return trackId ? (catalogById.get(trackId) ?? null) : null;
}

export function getNextMusicTrack(
  queue: readonly MusicTrack[],
  currentTrack: MusicTrack | null,
  offset: 1 | -1,
): MusicTrack | null {
  if (queue.length === 0) return null;
  const currentIndex = currentTrack
    ? queue.findIndex((track) => track.id === currentTrack.id)
    : -1;
  const startIndex = currentIndex < 0 ? 0 : currentIndex;
  return queue[(startIndex + offset + queue.length) % queue.length] ?? null;
}
