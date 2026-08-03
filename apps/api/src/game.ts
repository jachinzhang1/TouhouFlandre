import { Prisma } from "@prisma/client";
import {
  compareCharacter,
  GAME_CONTENT_DEFINITIONS,
  GAME_CONTENT_TYPES,
  getDailyAnswer,
  getPuzzleDateKey,
  normalizeSearchText,
  SINGLE_PLAYER_MODE_DEFINITIONS,
  toSearchResult,
} from "@touhoufriberg/shared";
import type {
  Character,
  CharacterSearchOptions,
  CatalogContentSummary,
  CatalogSummary,
  GameContentType,
  GuessResult,
  SessionStatus,
  SinglePlayerGameMode,
} from "@touhoufriberg/shared";
import {
  getCatalogCharacters,
  parseCatalogCharacters,
  parseGuesses,
  prisma,
  toCharacter,
  toPublicSession,
} from "./db";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const getCurrentCatalog = async () => {
  const state = await prisma.catalogState.findUnique({
    where: { id: "current" },
    include: { snapshot: true },
  });
  if (!state) throw new ApiError(503, "题库尚未初始化，请先运行 seed。");
  return {
    version: state.currentVersion,
    characters: parseCatalogCharacters(state.snapshot.charactersJson),
  };
};

const pickRandomAnswer = (characters: Character[]) => {
  const pool = characters.filter((character) => character.enabledAsAnswer);
  if (!pool.length) throw new ApiError(500, "题库中没有可作为答案的角色。");
  return pool[Math.floor(Math.random() * pool.length)];
};

export const searchCharacterRows = async (
  query: string,
  options: CharacterSearchOptions = {},
) => {
  const direction = options.direction ?? "asc";
  const primaryOrder =
    options.sort === "appearance"
      ? { appearanceOrder: direction }
      : { nameSortKey: direction };
  const normalizedQuery = normalizeSearchText(query);
  const where: Prisma.CharacterWhereInput = {
    enabledAsGuess: true,
    ...(normalizedQuery ? { searchText: { contains: normalizedQuery } } : {}),
  };
  const limit = Math.max(1, Math.min(options.limit ?? 50, 250));
  const offset = Math.max(0, options.offset ?? 0);

  const [rows, total] = await Promise.all([
    prisma.character.findMany({
      where,
      orderBy: [primaryOrder, { id: direction }],
      skip: offset,
      take: limit,
    }),
    prisma.character.count({ where }),
  ]);

  return { results: rows.map(toCharacter).map(toSearchResult), total };
};

type ContentHandler = {
  getSummary: () => Promise<CatalogContentSummary>;
  compareGuess: (
    characters: Character[],
    answerId: string,
    guessId: string,
  ) => GuessResult;
};

const contentHandlers: Record<GameContentType, ContentHandler> = {
  character: {
    getSummary: async () => {
      const [total, guessable, answerable] = await Promise.all([
        prisma.character.count(),
        prisma.character.count({ where: { enabledAsGuess: true } }),
        prisma.character.count({ where: { enabledAsAnswer: true } }),
      ]);
      const definition = GAME_CONTENT_DEFINITIONS.character;
      return {
        contentType: "character",
        label: definition.label,
        total,
        guessable,
        answerable,
        maxGuesses: definition.maxGuesses,
        visibleFieldCount: definition.fields.filter((field) => field.visible)
          .length,
      };
    },
    compareGuess: (characters, answerId, guessId) => {
      const guess = characters.find((character) => character.id === guessId);
      if (!guess || !guess.enabledAsGuess) {
        throw new ApiError(400, "请选择本局题库中的角色。");
      }
      const answer = characters.find((character) => character.id === answerId);
      if (!answer) throw new ApiError(500, "本局题库快照中缺少答案角色。");

      return compareCharacter(guess, answer);
    },
  },
};

export const getCatalogSummary = async (): Promise<CatalogSummary> => ({
  dailyDateKey: getPuzzleDateKey(),
  contents: await Promise.all(
    GAME_CONTENT_TYPES.map((contentType) =>
      contentHandlers[contentType].getSummary(),
    ),
  ),
});

const createSession = async (
  mode: SinglePlayerGameMode,
  contentType: GameContentType,
  answer: Character,
  catalogVersion: string,
  puzzleKey?: string,
) => {
  const session = await prisma.gameSession.create({
    data: {
      mode,
      contentType,
      answerId: answer.id,
      catalogVersion,
      puzzleKey,
      status: "playing",
      maxGuesses: GAME_CONTENT_DEFINITIONS[contentType].maxGuesses,
    },
  });
  return toPublicSession(session, await getCatalogCharacters(catalogVersion));
};

const getOrCreateDailyPuzzle = async (dateKey: string) => {
  const existing = await prisma.dailyPuzzle.findUnique({ where: { dateKey } });
  if (existing) {
    const characters = await getCatalogCharacters(existing.catalogVersion);
    const answer = characters.find(
      (character) => character.id === existing.answerId,
    );
    if (!answer) throw new ApiError(500, "每日题快照中缺少答案角色。");
    return { answer, catalogVersion: existing.catalogVersion };
  }

  const catalog = await getCurrentCatalog();
  const answer = getDailyAnswer(catalog.characters, dateKey);
  try {
    await prisma.dailyPuzzle.create({
      data: {
        dateKey,
        catalogVersion: catalog.version,
        answerId: answer.id,
      },
    });
    return { answer, catalogVersion: catalog.version };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return getOrCreateDailyPuzzle(dateKey);
    }
    throw error;
  }
};

const modeAnswerSelectors: Record<
  SinglePlayerGameMode,
  () => Promise<{
    answer: Character;
    catalogVersion: string;
    puzzleKey?: string;
  }>
> = {
  daily: async () => {
    const puzzleKey = getPuzzleDateKey();
    return { ...(await getOrCreateDailyPuzzle(puzzleKey)), puzzleKey };
  },
  random: async () => {
    const catalog = await getCurrentCatalog();
    return {
      answer: pickRandomAnswer(catalog.characters),
      catalogVersion: catalog.version,
    };
  },
};

export const createPuzzleSession = async (mode: SinglePlayerGameMode) => {
  const definition = SINGLE_PLAYER_MODE_DEFINITIONS[mode];
  const selection = await modeAnswerSelectors[mode]();
  return {
    puzzleLabel:
      mode === "daily"
        ? `${definition.label} ${selection.puzzleKey}`
        : definition.puzzleLabel,
    session: await createSession(
      mode,
      definition.contentType,
      selection.answer,
      selection.catalogVersion,
      selection.puzzleKey,
    ),
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
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const session = await prisma.gameSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new ApiError(404, "没有找到这一局游戏。");
    if (session.status !== "playing")
      throw new ApiError(409, "这一局已经结束。");

    const guesses = parseGuesses(session.guessesJson);
    if (guesses.some((entry) => entry.guessId === guessId)) {
      throw new ApiError(409, "这个角色已经猜过了。");
    }

    const characters = await getCatalogCharacters(session.catalogVersion);
    const handler = contentHandlers[session.contentType as GameContentType];
    if (!handler) {
      throw new ApiError(501, `暂不支持 ${session.contentType} 类型的猜测。`);
    }
    const result = handler.compareGuess(characters, session.answerId, guessId);
    const nextGuesses = [...guesses, result];
    const nextStatus: SessionStatus = result.isCorrect
      ? "won"
      : nextGuesses.length >= session.maxGuesses
        ? "lost"
        : "playing";

    const updated = await prisma.gameSession.updateMany({
      where: {
        id: sessionId,
        version: session.version,
        status: "playing",
      },
      data: {
        guessesJson: JSON.stringify(nextGuesses),
        status: nextStatus,
        endedAt: nextStatus === "playing" ? null : new Date(),
        version: { increment: 1 },
      },
    });
    if (!updated.count) continue;

    const saved = await prisma.gameSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    return toPublicSession(saved, characters);
  }

  throw new ApiError(409, "会话刚刚发生变化，请重新提交。");
};
