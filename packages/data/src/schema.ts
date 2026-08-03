import { z } from "zod";

export const hairColorSchema = z.enum([
  "black",
  "brown",
  "blonde",
  "white",
  "silver",
  "red",
  "pink",
  "purple",
  "blue",
  "green",
  "orange",
  "gray",
  "multicolor",
  "other",
]);

export const workSchema = z.object({
  id: z.string().min(1),
  titleZh: z.string().min(1),
  titleJa: z.string().min(1),
  titleEn: z.string().optional(),
  shortName: z.string().min(1),
  type: z.enum(["game", "print", "music_cd", "other"]),
  releaseYear: z.number().int(),
  mainlineIndex: z.number().int().optional(),
  era: z.enum(["pc98", "windows", "other"]).optional(),
});

export const characterSourceSchema = z.object({
  id: z.string().min(1),
  avatarUrl: z.string().startsWith("/characters/").endsWith(".png"),
  names: z.object({
    zhHans: z.string().min(1),
    zhHant: z.string().optional(),
    ja: z.string().min(1),
    en: z.string().min(1),
    romaji: z.string().optional(),
    aliases: z.array(z.string()),
  }),
  firstAppearance: z.object({
    workId: z.string().min(1),
  }),
  species: z.array(z.string().min(1)).min(1),
  abilityDisplay: z.string().min(1),
  abilityTags: z.array(z.string().min(1)).min(1),
  affiliations: z.array(z.string().min(1)).min(1),
  locations: z.array(z.string().min(1)).min(1),
  roles: z.array(z.string().min(1)).min(1),
  hairColors: z.array(hairColorSchema).min(1),
  playable: z.boolean(),
  enabledAsAnswer: z.boolean(),
  enabledAsGuess: z.boolean(),
  difficultyTier: z.enum(["easy", "normal", "hard", "lunatic"]),
  sourceRefs: z.array(z.string().url()).min(1),
});

export const characterSchema = characterSourceSchema;
export const charactersSchema = z.array(characterSourceSchema).min(1);
export const worksSchema = z.array(workSchema).min(1);
