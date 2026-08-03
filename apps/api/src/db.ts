import { PrismaClient } from "@prisma/client";
import {
  characterRuntimeListSchema,
  characterRuntimeSchema,
} from "@touhoufriberg/data";
import {
  FEEDBACK_STATUSES,
  GAME_CONTENT_TYPES,
  GUESS_FIELD_KEYS,
  SESSION_STATUSES,
  SINGLE_PLAYER_GAME_MODES,
} from "@touhoufriberg/shared";
import type { Character, GuessResult } from "@touhoufriberg/shared";
import { z } from "zod";

export const prisma = new PrismaClient();

type CharacterRow = Awaited<ReturnType<typeof prisma.character.findFirst>>;
type SessionRow = Awaited<ReturnType<typeof prisma.gameSession.findFirst>>;

const gameModeSchema = z.enum([...SINGLE_PLAYER_GAME_MODES, "multiplayer"]);
const fieldFeedbackSchema = z.object({
  field: z.enum(GUESS_FIELD_KEYS),
  label: z.string(),
  status: z.enum(FEEDBACK_STATUSES),
  symbol: z.enum(["O", "~", "X", "↑", "↓", "?"]),
  displayValue: z.array(z.string()),
});
const guessResultSchema = z.object({
  guessId: z.string(),
  guessName: z.string(),
  guessAvatarUrl: z.string().optional(),
  isCorrect: z.boolean(),
  feedback: z.array(fieldFeedbackSchema),
});
const guessResultsSchema = z.array(guessResultSchema);

const parseJson = (value: string): unknown => JSON.parse(value);

export const toCharacter = (row: NonNullable<CharacterRow>): Character =>
  characterRuntimeSchema.parse({
    id: row.id,
    avatarUrl: row.avatarUrl,
    appearanceOrder: row.appearanceOrder,
    names: parseJson(row.namesJson),
    firstAppearance: parseJson(row.firstAppearanceJson),
    species: parseJson(row.speciesJson),
    abilityDisplay: row.abilityDisplay,
    abilityTags: parseJson(row.abilityTagsJson),
    affiliations: parseJson(row.affiliationsJson),
    locations: parseJson(row.locationsJson),
    roles: parseJson(row.rolesJson),
    hairColors: parseJson(row.hairColorsJson),
    playable: row.playable,
    enabledAsAnswer: row.enabledAsAnswer,
    enabledAsGuess: row.enabledAsGuess,
    difficultyTier: row.difficultyTier,
    sourceRefs: parseJson(row.sourceRefsJson),
  });

export const parseCatalogCharacters = (value: string): Character[] =>
  characterRuntimeListSchema.parse(parseJson(value));

export const parseGuesses = (value: string): GuessResult[] =>
  guessResultsSchema.parse(parseJson(value));

export const hydrateGuessAvatars = (
  guesses: GuessResult[],
  characters: Character[],
): GuessResult[] => {
  const avatarsById = new Map(
    characters.map((character) => [character.id, character.avatarUrl]),
  );

  return guesses.map((guess) => ({
    ...guess,
    guessAvatarUrl: avatarsById.get(guess.guessId) ?? guess.guessAvatarUrl,
  }));
};

export const getCatalogCharacters = async (catalogVersion: string) => {
  const snapshot = await prisma.catalogSnapshot.findUnique({
    where: { version: catalogVersion },
  });
  if (!snapshot) throw new Error(`Missing catalog snapshot ${catalogVersion}.`);
  const characters = parseCatalogCharacters(snapshot.charactersJson);
  if (characters.length || catalogVersion !== "legacy") return characters;

  const rows = await prisma.character.findMany({ orderBy: { id: "asc" } });
  return rows.map(toCharacter);
};

export const toPublicSession = async (
  session: NonNullable<SessionRow>,
  catalogCharacters?: Character[],
) => {
  const characters =
    catalogCharacters ?? (await getCatalogCharacters(session.catalogVersion));
  const answer =
    session.status === "playing"
      ? undefined
      : characters.find((character) => character.id === session.answerId);

  if (session.status !== "playing" && !answer) {
    throw new Error(
      `Answer ${session.answerId} is missing from catalog ${session.catalogVersion}.`,
    );
  }

  return {
    id: session.id,
    mode: gameModeSchema.parse(session.mode),
    contentType: z.enum(GAME_CONTENT_TYPES).parse(session.contentType),
    status: z.enum(SESSION_STATUSES).parse(session.status),
    maxGuesses: session.maxGuesses,
    puzzleKey: session.puzzleKey ?? undefined,
    guesses: hydrateGuessAvatars(parseGuesses(session.guessesJson), characters),
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString(),
    answer,
  };
};
