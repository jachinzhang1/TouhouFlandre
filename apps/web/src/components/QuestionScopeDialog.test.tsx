import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuestionScopeDialog } from "./QuestionScopeDialog";

vi.mock("../lib/api", () => ({
  api: {
    catalogFull: vi.fn().mockResolvedValue({
      version: "catalog-without-extra",
      works: [
        {
          id: "th05",
          titleZh: "东方怪绮谈",
          titleJa: "東方怪綺談",
          shortName: "怪绮谈",
          pinyinInitials: ["gqt"],
          type: "stg",
          releaseYear: 1998,
          era: "pc98",
        },
      ],
      characters: [
        {
          id: "lunatic-character",
          avatarUrl: "/characters/0501-lunatic.png",
          appearanceOrder: 501,
          names: {
            zhHans: "高难角色",
            ja: "高难角色",
            en: "Lunatic",
            aliases: [],
          },
          firstAppearance: {
            workId: "th05",
            workTitle: "东方怪绮谈",
            workType: "stg",
            releaseYear: 1998,
            era: "pc98",
          },
          species: ["妖怪"],
          abilityDisplay: "能力",
          abilityTags: ["能力"],
          affiliations: ["旧作"],
          locations: ["幻想乡"],
          roles: ["角色"],
          hairColors: ["black"],
          playable: false,
          enabledAsAnswer: true,
          enabledAsGuess: true,
          difficultyTier: "lunatic",
          sourceRefs: ["https://example.com/lunatic"],
        },
      ],
      fieldDefinitions: [
        {
          key: "abilityTags",
          label: "能力标签",
          type: "multi_enum",
          configurable: true,
          defaultMode: "default",
          modes: [
            { key: "hidden", label: "关闭", enabled: false },
            { key: "default", label: "开启", enabled: true },
          ],
          equivalence: true,
        },
        {
          key: "releaseYear",
          label: "初登场年份",
          type: "number",
          configurable: true,
          defaultMode: "directional",
          modes: [
            { key: "hidden", label: "关闭", enabled: false },
            { key: "exactOnly", label: "仅精确", enabled: true },
            { key: "directional", label: "方向提示", enabled: true },
          ],
          equivalence: true,
        },
      ],
    }),
  },
}));

describe("QuestionScopeDialog", () => {
  beforeEach(() => localStorage.clear());

  it("shows and preserves the Extra preset before extra data exists", async () => {
    render(<QuestionScopeDialog open onClose={() => undefined} />);

    const extra = await screen.findByRole("button", { name: /Extra/ });
    expect(within(extra).getByText("包含仅在旧作中登场的角色")).toBeTruthy();

    fireEvent.click(extra);
    expect(screen.getByText("当前难度：Extra")).toBeTruthy();
  });

  it("renders fields and comparison modes from the catalog registry", async () => {
    render(<QuestionScopeDialog open onClose={() => undefined} />);

    const ability = await screen.findByRole("checkbox", { name: "能力标签" });
    expect(ability.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(ability);
    expect(ability.getAttribute("aria-checked")).toBe("false");

    const comparison = screen.getByRole("combobox", {
      name: "初登场年份比较模式",
    });
    expect(
      within(comparison).getByRole("option", { name: "仅精确" }),
    ).toBeTruthy();
    expect(
      within(comparison).getByRole("option", { name: "方向提示" }),
    ).toBeTruthy();
  });
});
