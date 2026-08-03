import { describe, expect, it } from "vitest";
import { demoCatalogVersion, demoCharacters, getAppearanceOrder } from "../src";

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
