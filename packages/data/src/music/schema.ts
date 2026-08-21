import { z } from "zod";

const stableIdSchema = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
    "Music IDs must be stable ASCII slugs.",
  );

const sourceRefsSchema = z
  .array(z.string().url())
  .min(1)
  .refine(
    (values) => values.every((value) => /^https?:\/\//u.test(value)),
    "Music sources must use HTTP(S) URLs.",
  )
  .refine((values) => new Set(values).size === values.length, {
    message: "Music source URLs must be unique.",
  });

const coverUrlSchema = z
  .string()
  .regex(
    /^\/music\/covers\/[a-z0-9-]+\.(?:png|jpe?g|webp)$/u,
    "Cover URLs must point to a local /music/covers asset.",
  );

const audioUrlSchema = z
  .string()
  .regex(
    /^\/music\/tracks\/[a-z0-9-]+\/[a-z0-9-]+\.mp3$/u,
    "Audio URLs must point to a local /music/tracks MP3 asset.",
  );

const uniqueStringArraySchema = z
  .array(z.string().trim().min(1))
  .min(1)
  .refine((values) => new Set(values).size === values.length, {
    message: "Music string arrays must contain unique values.",
  });

export const musicAlbumCategorySchema = z.enum([
  "game_ost",
  "zun_music_cd",
  "tasofro_game_ost",
]);

export type MusicAlbumCategory = z.infer<typeof musicAlbumCategorySchema>;

export const musicAlbumSchema = z.object({
  id: stableIdSchema,
  category: musicAlbumCategorySchema,
  title: z.string().trim().min(1),
  titleJa: z.string().trim().min(1).optional(),
  artist: z.string().trim().min(1).optional(),
  releaseYear: z.number().int().optional(),
  order: z.number().int().nonnegative(),
  coverUrl: coverUrlSchema,
  sourceRefs: sourceRefsSchema,
});

export const musicTrackSchema = z.object({
  id: stableIdSchema,
  albumId: stableIdSchema,
  trackNumber: z.number().int().positive(),
  title: z.string().trim().min(1),
  titleJa: z.string().trim().min(1).optional(),
  artists: uniqueStringArraySchema,
  composer: z.string().trim().min(1).optional(),
  arranger: z.string().trim().min(1).optional(),
  audioUrl: audioUrlSchema,
  coverUrl: coverUrlSchema.optional(),
  sourceRefs: sourceRefsSchema,
});

export const musicAlbumsSchema = z.array(musicAlbumSchema).min(1);
export const musicTracksSchema = z.array(musicTrackSchema).min(1);

export type MusicAudioUrl = `/music/tracks/${string}.mp3`;
export type MusicCoverUrl = `/music/covers/${string}`;
export type MusicAlbum = Omit<z.infer<typeof musicAlbumSchema>, "coverUrl"> & {
  coverUrl: MusicCoverUrl;
};
export type MusicTrack = Omit<
  z.infer<typeof musicTrackSchema>,
  "audioUrl" | "coverUrl"
> & {
  audioUrl: MusicAudioUrl;
  coverUrl?: MusicCoverUrl;
};
