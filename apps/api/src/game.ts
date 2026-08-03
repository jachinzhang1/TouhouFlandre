import {
  compareCharacter,
  GAME_CONTENT_DEFINITIONS,
  getDailyAnswer,
  searchCharacters,
  SINGLE_PLAYER_MODE_DEFINITIONS,
} from "@touhoufriberg/shared";
import type {
  Character,
  CharacterSearchOptions,
  CatalogSummary,
  GameContentType,
  GuessResult,
  SessionStatus,
  SinglePlayerGameMode,
} from "@touhoufriberg/shared";
import { prisma, parseGuesses, toCharacter, toPublicSession } from "./db";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const getCharacters = async () => {
  const rows = await prisma.character.findMany({ orderBy: { id: "asc" } });
  return rows.map(toCharacter);
};

const getCharacterById = async (id: string) => {
  const row = await prisma.character.findUnique({ where: { id } });
  return row ? toCharacter(row) : null;
};

const pickRandomAnswer = (characters: Character[]) => {
  const pool = characters.filter((character) => character.enabledAsAnswer);
  if (!pool.length) throw new ApiError(500, "题库中没有可作为答案的角色。");
  return pool[Math.floor(Math.random() * pool.length)];
};

export const searchCharacterRows = async (
  query: string,
  options?: CharacterSearchOptions,
) => searchCharacters(await getCharacters(), query, options);

export const getCatalogSummary = async (): Promise<CatalogSummary> => {
  const [total, guessable, answerable] = await Promise.all([
    prisma.character.count(),
    prisma.character.count({ where: { enabledAsGuess: true } }),
    prisma.character.count({ where: { enabledAsAnswer: true } }),
  ]);
  const definition = GAME_CONTENT_DEFINITIONS.character;

  return {
    contents: [
      {
        contentType: "character" as const,
        label: definition.label,
        total,
        guessable,
        answerable,
        maxGuesses: definition.maxGuesses,
        visibleFieldCount: definition.fields.filter((field) => field.visible)
          .length,
      },
    ],
  };
};

export const createSession = async (
  mode: SinglePlayerGameMode,
  contentType: GameContentType,
  answer: Character,
) => {
  const session = await prisma.gameSession.create({
    data: {
      mode,
      contentType,
      answerId: answer.id,
      status: "playing",
      maxGuesses: GAME_CONTENT_DEFINITIONS[contentType].maxGuesses,
    },
  });

  return toPublicSession(session);
};

const modeAnswerSelectors: Record<
  SinglePlayerGameMode,
  (dateKey?: string) => Promise<Character>
> = {
  daily: async (dateKey) => getDailyAnswer(await getCharacters(), dateKey),
  random: async () => pickRandomAnswer(await getCharacters()),
};

export const createPuzzleSession = async (
  mode: SinglePlayerGameMode,
  dateKey?: string,
) => {
  const definition = SINGLE_PLAYER_MODE_DEFINITIONS[mode];
  const answer = await modeAnswerSelectors[mode](dateKey);
  return {
    puzzleLabel:
      mode === "daily" && dateKey
        ? `${definition.label} ${dateKey}`
        : definition.puzzleLabel,
    session: await createSession(mode, definition.contentType, answer),
  };
};

export const getPublicSession = async (sessionId: string) => {
  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) throw new ApiError(404, "没有找到这一局游戏。");
  return toPublicSession(session);
};

export const submitGuess = async (sessionId: string, guessId: string) => {
  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) throw new ApiError(404, "没有找到这一局游戏。");
  if (session.status !== "playing") throw new ApiError(409, "这一局已经结束。");
  if (session.contentType !== "character") {
    throw new ApiError(501, `暂不支持 ${session.contentType} 类型的猜测。`);
  }

  const guess = await getCharacterById(guessId);
  if (!guess || !guess.enabledAsGuess)
    throw new ApiError(400, "请选择题库中的角色。");

  const guesses = parseGuesses(session.guessesJson);
  if (guesses.some((entry) => entry.guessId === guessId)) {
    throw new ApiError(409, "这个角色已经猜过了。");
  }

  const answer = await getCharacterById(session.answerId);
  if (!answer) throw new ApiError(500, "答案角色不存在，请重新 seed 数据。");

  const result: GuessResult = compareCharacter(guess, answer);
  const nextGuesses = [...guesses, result];
  const nextStatus: SessionStatus = result.isCorrect
    ? "won"
    : nextGuesses.length >= session.maxGuesses
      ? "lost"
      : "playing";

  const updated = await prisma.gameSession.update({
    where: { id: sessionId },
    data: {
      guessesJson: JSON.stringify(nextGuesses),
      status: nextStatus,
      endedAt: nextStatus === "playing" ? null : new Date(),
    },
  });

  return toPublicSession(updated);
};
