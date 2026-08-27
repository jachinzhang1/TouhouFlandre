import { z } from "zod";
import {
  DIFFICULTY_TIERS,
  HAIR_COLORS,
  WORK_TYPES,
} from "@touhouflandre/shared";

export const hairColorSchema = z.enum(HAIR_COLORS);
export const difficultyTierSchema = z.enum(DIFFICULTY_TIERS);
const uniqueStringArray = z
  .array(z.string().trim().min(1))
  .min(1)
  .refine((values) => new Set(values).size === values.length, {
    message: "Values must be unique.",
  });
const pinyinInitialsSchema = z
  .array(z.string().regex(/^[a-z0-9]+$/u))
  .min(1)
  .refine((values) => new Set(values).size === values.length, {
    message: "Pinyin initials must be unique within a work.",
  });

export const workSchema = z.object({
  id: z.string().min(1),
  titleZh: z.string().min(1),
  titleJa: z.string().min(1),
  titleEn: z.string().optional(),
  shortName: z.string().min(1),
  pinyinInitials: pinyinInitialsSchema,
  type: z.enum(WORK_TYPES),
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
  species: uniqueStringArray,
  abilityDisplay: z.string().min(1),
  abilityTags: uniqueStringArray,
  affiliations: uniqueStringArray,
  locations: uniqueStringArray,
  roles: uniqueStringArray,
  hairColors: z.array(hairColorSchema).min(1),
  playable: z.boolean(),
  enabledAsAnswer: z.boolean(),
  enabledAsGuess: z.boolean(),
  difficultyTier: difficultyTierSchema,
  sourceRefs: z.array(z.string().url()).min(1),
});

export const characterSchema = characterSourceSchema;
export const charactersSchema = z.array(characterSourceSchema).min(1);
export const worksSchema = z.array(workSchema).min(1);

export const characterRuntimeSchema = characterSourceSchema.extend({
  appearanceOrder: z.number().int().min(0).max(9999),
  firstAppearance: z.object({
    workId: z.string().min(1),
    workTitle: z.string().min(1),
    workType: z.enum(WORK_TYPES),
    releaseYear: z.number().int(),
    mainlineIndex: z.number().int().optional(),
    era: z.enum(["pc98", "windows", "other"]).optional(),
    workPinyinInitials: pinyinInitialsSchema,
  }),
});
export const characterRuntimeListSchema = z.array(characterRuntimeSchema);
