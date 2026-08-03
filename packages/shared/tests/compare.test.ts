import { describe, expect, it } from "vitest";
import {
  compareCharacters,
  compareCharacter,
  createShareText,
  getDailyAnswer,
  getPuzzleDateKey,
  searchCharacters,
} from "../src";
import type {
  Character,
  FirstAppearance,
  LocalizedNames,
  PublicGameSession,
} from "../src";

const baseCharacter: Character = {
  id: "base",
  avatarUrl: "/characters/base.png",
  appearanceOrder: 601,
  names: {
    zhHans: "测试角色",
    ja: "テスト",
    en: "Test",
    aliases: [],
  },
  firstAppearance: {
    workId: "th06",
    workTitle: "东方红魔乡",
    workType: "game",
    releaseYear: 2002,
  },
  species: ["妖怪"],
  abilityDisplay: "测试能力",
  abilityTags: ["操纵"],
  affiliations: ["红魔馆"],
  locations: ["幻想乡"],
  roles: ["Boss"],
  hairColors: ["blue"],
  playable: false,
  enabledAsAnswer: true,
  enabledAsGuess: true,
  difficultyTier: "easy",
  sourceRefs: [],
};

type CharacterPatch = Omit<Partial<Character>, "names" | "firstAppearance"> & {
  names?: Partial<LocalizedNames>;
  firstAppearance?: Partial<FirstAppearance>;
};

const makeCharacter = (patch: CharacterPatch): Character => ({
  ...baseCharacter,
  ...patch,
  names: { ...baseCharacter.names, ...patch.names },
  firstAppearance: {
    ...baseCharacter.firstAppearance,
    ...patch.firstAppearance,
  },
});

describe("compareCharacter", () => {
  it("marks hair color exact matches", () => {
    const result = compareCharacter(
      makeCharacter({ hairColors: ["blue"] }),
      baseCharacter,
    );
    expect(
      result.feedback.find((field) => field.field === "hairColors")?.status,
    ).toBe("exact");
  });

  it("marks hair color partial matches", () => {
    const result = compareCharacter(
      makeCharacter({ hairColors: ["blue", "green"] }),
      baseCharacter,
    );
    expect(
      result.feedback.find((field) => field.field === "hairColors")?.status,
    ).toBe("partial");
  });

  it("marks hair color misses", () => {
    const result = compareCharacter(
      makeCharacter({ hairColors: ["red"] }),
      baseCharacter,
    );
    expect(
      result.feedback.find((field) => field.field === "hairColors")?.status,
    ).toBe("miss");
  });

  it("points release year toward the answer", () => {
    const result = compareCharacter(
      makeCharacter({ firstAppearance: { releaseYear: 1997 } }),
      makeCharacter({ firstAppearance: { releaseYear: 2002 } }),
    );
    expect(
      result.feedback.find((field) => field.field === "releaseYear")?.status,
    ).toBe("higher");
  });
});

describe("daily puzzle", () => {
  it("uses the Asia/Shanghai calendar date", () => {
    expect(getPuzzleDateKey(new Date("2026-08-02T16:30:00.000Z"))).toBe(
      "2026-08-03",
    );
  });

  it("returns the same answer for the same date", () => {
    const characters = [
      makeCharacter({ id: "a" }),
      makeCharacter({ id: "b", names: { zhHans: "角色 B" } }),
    ];
    expect(getDailyAnswer(characters, "2026-08-03").id).toBe(
      getDailyAnswer(characters, "2026-08-03").id,
    );
  });

  it("is independent of catalog ordering", () => {
    const characters = [
      makeCharacter({ id: "a" }),
      makeCharacter({ id: "b", names: { zhHans: "角色 B" } }),
      makeCharacter({ id: "c", names: { zhHans: "角色 C" } }),
    ];
    expect(getDailyAnswer(characters, "2026-08-03").id).toBe(
      getDailyAnswer([...characters].reverse(), "2026-08-03").id,
    );
  });
});

describe("share text", () => {
  it("does not include the answer name", () => {
    const session: PublicGameSession = {
      id: "session",
      mode: "daily",
      contentType: "character",
      status: "won",
      maxGuesses: 8,
      startedAt: new Date().toISOString(),
      answer: makeCharacter({ id: "answer", names: { zhHans: "秘密答案" } }),
      guesses: [
        compareCharacter(
          makeCharacter({ id: "guess", names: { zhHans: "公开猜测" } }),
          baseCharacter,
        ),
      ],
    };

    expect(createShareText(session, "#1")).not.toContain("秘密答案");
  });
});

describe("character search", () => {
  const characters = Array.from({ length: 15 }, (_, index) =>
    makeCharacter({
      id: `character-${index}`,
      avatarUrl: `/characters/character-${index}.png`,
      names: { zhHans: `角色 ${index}` },
    }),
  );

  it("returns the complete guessable catalog by default", () => {
    const page = searchCharacters(characters, "");
    expect(page.total).toBe(15);
    expect(page.results).toHaveLength(15);
  });

  it("limits suggestions without changing the total", () => {
    const page = searchCharacters(characters, "", { limit: 12 });
    expect(page.total).toBe(15);
    expect(page.results).toHaveLength(12);
    expect(page.results[0].avatarUrl).toBe("/characters/character-0.png");
  });

  it("sorts by appearance order in both directions", () => {
    const unordered = [
      makeCharacter({ id: "mystia", appearanceOrder: 802 }),
      makeCharacter({ id: "wriggle", appearanceOrder: 801 }),
    ];
    expect(
      searchCharacters(unordered, "", {
        sort: "appearance",
        direction: "asc",
      }).results.map((result) => result.id),
    ).toEqual(["wriggle", "mystia"]);
    expect(
      searchCharacters(unordered, "", {
        sort: "appearance",
        direction: "desc",
      }).results.map((result) => result.id),
    ).toEqual(["mystia", "wriggle"]);
  });

  it("uses romanized names for alphabetical sorting", () => {
    const reimu = makeCharacter({
      id: "reimu",
      names: { en: "Reimu Hakurei" },
    });
    const marisa = makeCharacter({
      id: "marisa",
      names: { en: "Marisa Kirisame" },
    });
    expect(compareCharacters(reimu, marisa, "name", "asc")).toBeGreaterThan(0);
  });
});
