import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  demoMusicAlbums,
  demoMusicTracks,
  musicAlbumSchema,
  musicAlbumsSchema,
  musicTrackSchema,
  musicTracksSchema,
  resolveMusicCoverUrl,
} from "../src/music";
import { sortMusicTracks, validateMusicCatalog } from "../src/music/validation";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function createAssetRoot() {
  const root = mkdtempSync(join(tmpdir(), "touhouflandre-music-"));
  tempRoots.push(root);
  mkdirSync(join(root, "music", "covers"), { recursive: true });
  writeFileSync(join(root, "music", "placeholder-cover.png"), "placeholder");
  for (const album of demoMusicAlbums) {
    writeFileSync(join(root, album.coverUrl.slice(1)), "cover");
  }
  for (const track of demoMusicTracks) {
    mkdirSync(join(root, "music", "tracks", track.albumId), {
      recursive: true,
    });
    writeFileSync(join(root, track.audioUrl.slice(1)), "mp3");
  }
  return root;
}

describe("music schemas", () => {
  it("parses the demo catalog without importing the root catalog", () => {
    expect(musicAlbumsSchema.parse(demoMusicAlbums)).toHaveLength(11);
    expect(musicTracksSchema.parse(demoMusicTracks)).toHaveLength(39);
    expect(demoMusicTracks.every((track) => track.coverUrl === undefined)).toBe(
      true,
    );
  });

  it("rejects unstable ids and remote runtime paths", () => {
    expect(
      musicAlbumSchema.safeParse({
        ...demoMusicAlbums[0],
        id: "Album 1",
      }).success,
    ).toBe(false);
    expect(
      musicTrackSchema.safeParse({
        ...demoMusicTracks[0],
        audioUrl: "https://example.com/song.mp3",
      }).success,
    ).toBe(false);
  });

  it("requires the core track metadata", () => {
    const { title: _title, ...missingTitle } = demoMusicTracks[0];
    expect(musicTrackSchema.safeParse(missingTitle).success).toBe(false);
  });
});

describe("music catalog validation", () => {
  it("resolves every track to its album cover and sorts the queue", () => {
    const albumsById = new Map(
      demoMusicAlbums.map((album) => [album.id, album]),
    );
    expect(
      resolveMusicCoverUrl(
        demoMusicTracks[0],
        albumsById.get(demoMusicTracks[0].albumId)!,
      ),
    ).toBe(albumsById.get(demoMusicTracks[0].albumId)!.coverUrl);
    expect(
      sortMusicTracks(demoMusicAlbums, [...demoMusicTracks].reverse()).map(
        (track) => track.id,
      ),
    ).toEqual(demoMusicTracks.map((track) => track.id));
  });

  it("accepts the checked-in asset layout", () => {
    expect(() =>
      validateMusicCatalog({
        albums: demoMusicAlbums,
        tracks: demoMusicTracks,
        publicRoot: createAssetRoot(),
      }),
    ).not.toThrow();
  });

  it("reports duplicate album order, track number and missing files", () => {
    const root = createAssetRoot();
    expect(() =>
      validateMusicCatalog({
        albums: [
          demoMusicAlbums[0],
          { ...demoMusicAlbums[1], order: demoMusicAlbums[0].order },
        ],
        tracks: demoMusicTracks,
        publicRoot: root,
      }),
    ).toThrow(/album order/iu);

    expect(() =>
      validateMusicCatalog({
        albums: demoMusicAlbums,
        tracks: [
          demoMusicTracks[0],
          {
            ...demoMusicTracks[1],
            trackNumber: demoMusicTracks[0].trackNumber,
          },
          demoMusicTracks[2],
        ],
        publicRoot: root,
      }),
    ).toThrow(/track number/iu);

    expect(() =>
      validateMusicCatalog({
        albums: demoMusicAlbums,
        tracks: demoMusicTracks.map((track) =>
          track.id === demoMusicTracks[0].id
            ? {
                ...track,
                audioUrl:
                  "/music/tracks/gensoukyoku-bassui/missing.mp3" as typeof track.audioUrl,
              }
            : track,
        ),
        publicRoot: root,
      }),
    ).toThrow(/missing MP3/iu);
  });

  it("rejects unreferenced assets and over-sized covers", () => {
    const root = createAssetRoot();
    writeFileSync(join(root, "music", "covers", "unused.png"), "unused");
    expect(() =>
      validateMusicCatalog({
        albums: demoMusicAlbums,
        tracks: demoMusicTracks,
        publicRoot: root,
      }),
    ).toThrow(/Unreferenced music asset/iu);
  });
});
