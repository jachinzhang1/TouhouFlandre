import { PrismaClient } from "@prisma/client";
import type { Character, DifficultyTier, FirstAppearance, GameMode, GuessResult, HairColor, LocalizedNames, SessionStatus } from "@touhoufriberg/shared";

export const prisma = new PrismaClient();

type CharacterRow = Awaited<ReturnType<typeof prisma.character.findFirst>>;

const parseJson = <T>(value: string): T => JSON.parse(value) as T;

export const toCharacter = (row: NonNullable<CharacterRow>): Character => ({
  id: row.id,
  names: parseJson<LocalizedNames>(row.namesJson),
  firstAppearance: parseJson<FirstAppearance>(row.firstAppearanceJson),
  species: parseJson<string[]>(row.speciesJson),
  abilityDisplay: row.abilityDisplay,
  abilityTags: parseJson<string[]>(row.abilityTagsJson),
  affiliations: parseJson<string[]>(row.affiliationsJson),
  locations: parseJson<string[]>(row.locationsJson),
  roles: parseJson<string[]>(row.rolesJson),
  hairColors: parseJson<HairColor[]>(row.hairColorsJson),
  playable: row.playable,
  enabledAsAnswer: row.enabledAsAnswer,
  enabledAsGuess: row.enabledAsGuess,
  difficultyTier: row.difficultyTier as DifficultyTier,
  sourceRefs: parseJson<string[]>(row.sourceRefsJson)
});

export const parseGuesses = (value: string): GuessResult[] => parseJson<GuessResult[]>(value);

export const toPublicSession = async (session: {
  id: string;
  mode: string;
  answerId: string;
  status: string;
  maxGuesses: number;
  guessesJson: string;
  startedAt: Date;
  endedAt: Date | null;
}) => {
  const answerRow =
    session.status === "playing" ? null : await prisma.character.findUnique({ where: { id: session.answerId } });

  return {
    id: session.id,
    mode: session.mode as GameMode,
    status: session.status as SessionStatus,
    maxGuesses: session.maxGuesses,
    guesses: parseGuesses(session.guessesJson),
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString(),
    answer: answerRow ? toCharacter(answerRow) : undefined
  };
};
