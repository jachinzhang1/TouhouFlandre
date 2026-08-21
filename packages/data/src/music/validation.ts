import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { MusicAlbum, MusicTrack } from "./schema";

export const MUSIC_ASSET_LIMITS = {
  maxTotalAudioBytes: 200 * 1024 * 1024,
  maxCoverBytes: 2 * 1024 * 1024,
} as const;

type MusicValidationOptions = {
  albums: readonly MusicAlbum[];
  tracks: readonly MusicTrack[];
  publicRoot: string;
};

function assertOrThrow(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function collectFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(path) : [path];
  });
}

function assetPath(publicRoot: string, url: string): string {
  const musicRoot = resolve(publicRoot, "music");
  const path = resolve(publicRoot, `.${url}`);
  const relativePath = relative(musicRoot, path);
  assertOrThrow(
    relativePath !== "" &&
      !relativePath.startsWith("..") &&
      !relativePath.includes(".." + "/"),
    `Music asset escapes /music: ${url}`,
  );
  return path;
}

function canonicalTrackOrder(
  albums: readonly MusicAlbum[],
  tracks: readonly MusicTrack[],
): MusicTrack[] {
  const albumOrder = new Map(albums.map((album) => [album.id, album.order]));
  return [...tracks].sort(
    (left, right) =>
      (albumOrder.get(left.albumId) ?? Number.MAX_SAFE_INTEGER) -
        (albumOrder.get(right.albumId) ?? Number.MAX_SAFE_INTEGER) ||
      left.trackNumber - right.trackNumber ||
      left.id.localeCompare(right.id),
  );
}

export function sortMusicTracks(
  albums: readonly MusicAlbum[],
  tracks: readonly MusicTrack[],
): MusicTrack[] {
  return canonicalTrackOrder(albums, tracks);
}

export function validateMusicCatalog({
  albums,
  tracks,
  publicRoot,
}: MusicValidationOptions): void {
  const albumIds = new Set<string>();
  const albumOrders = new Set<number>();
  const albumsById = new Map<string, MusicAlbum>();

  for (const album of albums) {
    assertOrThrow(
      !albumIds.has(album.id),
      `Duplicate music album id: ${album.id}`,
    );
    assertOrThrow(
      !albumOrders.has(album.order),
      `Duplicate music album order ${album.order}: ${album.id}`,
    );
    albumIds.add(album.id);
    albumOrders.add(album.order);
    albumsById.set(album.id, album);

    const coverPath = assetPath(publicRoot, album.coverUrl);
    assertOrThrow(
      existsSync(coverPath),
      `${album.id} references missing cover ${coverPath}`,
    );
  }

  const trackIds = new Set<string>();
  const trackNumbersByAlbum = new Map<string, Set<number>>();
  let totalAudioBytes = 0;
  const referencedFiles = new Set<string>();
  referencedFiles.add(resolve(publicRoot, "music", "placeholder-cover.png"));

  for (const album of albums) {
    referencedFiles.add(assetPath(publicRoot, album.coverUrl));
  }

  for (const track of tracks) {
    assertOrThrow(
      !trackIds.has(track.id),
      `Duplicate music track id: ${track.id}`,
    );
    const album = albumsById.get(track.albumId);
    assertOrThrow(
      album !== undefined,
      `${track.id} references missing album ${track.albumId}`,
    );

    const trackNumbers =
      trackNumbersByAlbum.get(track.albumId) ?? new Set<number>();
    assertOrThrow(
      !trackNumbers.has(track.trackNumber),
      `Duplicate track number ${track.trackNumber} in album ${track.albumId}`,
    );
    trackNumbers.add(track.trackNumber);
    trackNumbersByAlbum.set(track.albumId, trackNumbers);
    trackIds.add(track.id);

    const audioPath = assetPath(publicRoot, track.audioUrl);
    assertOrThrow(
      existsSync(audioPath),
      `${track.id} references missing MP3 ${audioPath}`,
    );
    totalAudioBytes += statSync(audioPath).size;
    referencedFiles.add(audioPath);

    if (track.coverUrl) {
      const coverPath = assetPath(publicRoot, track.coverUrl);
      assertOrThrow(
        existsSync(coverPath),
        `${track.id} references missing cover ${coverPath}`,
      );
      referencedFiles.add(coverPath);
    }
  }

  assertOrThrow(
    existsSync(resolve(publicRoot, "music", "placeholder-cover.png")),
    "Music placeholder cover is missing: /music/placeholder-cover.png",
  );
  assertOrThrow(
    totalAudioBytes <= MUSIC_ASSET_LIMITS.maxTotalAudioBytes,
    `Music MP3 budget exceeded: ${totalAudioBytes} bytes`,
  );

  for (const path of collectFiles(resolve(publicRoot, "music"))) {
    const lower = path.toLowerCase();
    if (!/\.(?:mp3|png|jpe?g|webp)$/u.test(lower)) continue;
    assertOrThrow(
      referencedFiles.has(path),
      `Unreferenced music asset: ${path}`,
    );
    if (/\.(?:png|jpe?g|webp)$/u.test(lower)) {
      assertOrThrow(
        statSync(path).size <= MUSIC_ASSET_LIMITS.maxCoverBytes,
        `Music cover budget exceeded: ${path}`,
      );
    }
  }

  const sorted = canonicalTrackOrder(albums, tracks);
  assertOrThrow(
    sorted.every((track, index) => track.id === tracks[index]?.id),
    "Music tracks must be stored in album order, track number, then id order.",
  );
}
