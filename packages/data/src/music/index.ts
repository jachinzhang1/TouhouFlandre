import albumsJson from "./albums.demo.json" with { type: "json" };
import tracksJson from "./tracks.demo.json" with { type: "json" };
import {
  musicAlbumsSchema,
  musicTracksSchema,
  type MusicAlbum,
  type MusicTrack,
  type MusicCoverUrl,
} from "./schema";

export const demoMusicAlbums = musicAlbumsSchema.parse(
  albumsJson,
) as MusicAlbum[];
export const demoMusicTracks = musicTracksSchema.parse(
  tracksJson,
) as MusicTrack[];

export function resolveMusicCoverUrl(
  track: MusicTrack,
  album: MusicAlbum,
): MusicCoverUrl {
  return track.coverUrl ?? album.coverUrl;
}

export * from "./schema";
