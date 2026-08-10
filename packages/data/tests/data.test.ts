import { describe, expect, it } from "vitest";
import {
  demoCatalogVersion,
  demoCharacters,
  getAppearanceOrder,
  hairColorSchema,
  workSchema,
} from "../src";

describe("catalog metadata", () => {
  it("parses the four-digit portrait order", () => {
    expect(getAppearanceOrder("/characters/0601-露米娅.png")).toBe(601);
    expect(getAppearanceOrder("/characters/0751-伊吹萃香.png")).toBe(751);
  });

  it("keeps in-work character order", () => {
    const wriggle = demoCharacters.find(
      (character) => character.id === "wriggle_nightbug",
    );
    const mystia = demoCharacters.find(
      (character) => character.id === "mystia_lorelei",
    );
    expect(wriggle?.appearanceOrder).toBeLessThan(
      mystia?.appearanceOrder ?? Number.NEGATIVE_INFINITY,
    );
  });

  it("produces a deterministic catalog version", () => {
    expect(demoCatalogVersion).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("hair color preset", () => {
  it("accepts none as a bald marker", () => {
    expect(hairColorSchema.safeParse("none").success).toBe(true);
  });
});

describe("work type preset", () => {
  const baseWork = {
    id: "th06_eosd",
    titleZh: "东方红魔乡",
    titleJa: "東方紅魔郷",
    shortName: "红魔乡",
    releaseYear: 2002,
  };

  it("accepts split game genres and legacy game values", () => {
    for (const type of ["ftg", "stg", "game"]) {
      expect(workSchema.safeParse({ ...baseWork, type }).success).toBe(true);
    }
  });
});
