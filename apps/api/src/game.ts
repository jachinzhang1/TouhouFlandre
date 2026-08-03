import { compareCharacter, getDailyAnswer, searchCharacters } from "@touhoufriberg/shared";
import type { Character, GameMode, GuessResult, SessionStatus } from "@touhoufriberg/shared";
import { prisma, parseGuesses, toCharacter, toPublicSession } from "./db";

const MAX_GUESSES = 8;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
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

export const searchCharacterRows = async (query: string) => searchCharacters(await getCharacters(), query);

export const createSession = async (mode: GameMode, answer: Character) => {
  const session = await prisma.gameSession.create({
    data: {
      mode,
      answerId: answer.id,
      status: "playing",
      maxGuesses: MAX_GUESSES
    }
  });

  return toPublicSession(session);
};

export const createDailySession = async (dateKey?: string) => {
  const answer = getDailyAnswer(await getCharacters(), dateKey);
  return createSession("daily", answer);
};

export const createRandomSession = async () => {
  const answer = pickRandomAnswer(await getCharacters());
  return createSession("random", answer);
};

export const getPublicSession = async (sessionId: string) => {
  const session = await prisma.gameSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new ApiError(404, "没有找到这一局游戏。");
  return toPublicSession(session);
};

export const submitGuess = async (sessionId: string, characterId: string) => {
  const session = await prisma.gameSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new ApiError(404, "没有找到这一局游戏。");
  if (session.status !== "playing") throw new ApiError(409, "这一局已经结束。");

  const guess = await getCharacterById(characterId);
  if (!guess || !guess.enabledAsGuess) throw new ApiError(400, "请选择题库中的角色。");

  const guesses = parseGuesses(session.guessesJson);
  if (guesses.some((entry) => entry.guessId === characterId)) {
    throw new ApiError(409, "这个角色已经猜过了。");
  }

  const answer = await getCharacterById(session.answerId);
  if (!answer) throw new ApiError(500, "答案角色不存在，请重新 seed 数据。");

  const result: GuessResult = compareCharacter(guess, answer);
  const nextGuesses = [...guesses, result];
  const nextStatus: SessionStatus = result.isCorrect ? "won" : nextGuesses.length >= session.maxGuesses ? "lost" : "playing";

  const updated = await prisma.gameSession.update({
    where: { id: sessionId },
    data: {
      guessesJson: JSON.stringify(nextGuesses),
      status: nextStatus,
      endedAt: nextStatus === "playing" ? null : new Date()
    }
  });

  return toPublicSession(updated);
};
