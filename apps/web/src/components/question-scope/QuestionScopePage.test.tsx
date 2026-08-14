import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeQuestionScope,
  type Character,
  type FullCatalogSnapshot,
  type Work,
} from "@touhouflandre/shared";
import { QUESTION_SCOPE_STORAGE_KEY } from "../../lib/questionScopeStorage";
import { QuestionScopePage } from "./QuestionScopePage";

const mocks = vi.hoisted(() => ({
  catalogFull: vi.fn(),
  push: vi.fn(),
  roomInfo: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("../../lib/api", () => ({
  api: {
    catalogFull: mocks.catalogFull,
    roomInfo: mocks.roomInfo,
  },
}));

const work: Work = {
  id: "th06",
  titleZh: "东方红魔乡",
  titleJa: "東方紅魔郷",
  shortName: "红魔乡",
  pinyinInitials: ["hms"],
  type: "game",
  releaseYear: 2002,
  mainlineIndex: 6,
  era: "windows",
};

const character: Character = {
  id: "reimu",
  avatarUrl: "",
  appearanceOrder: 1,
  names: { zhHans: "博丽灵梦", ja: "博麗霊夢", en: "Reimu", aliases: [] },
  firstAppearance: {
    workId: work.id,
    workTitle: work.titleZh,
    workType: "game",
    releaseYear: 2002,
    mainlineIndex: 6,
    era: "windows",
  },
  species: [],
  abilityDisplay: "",
  abilityTags: [],
  affiliations: [],
  locations: [],
  roles: [],
  hairColors: [],
  playable: true,
  enabledAsAnswer: true,
  enabledAsGuess: true,
  difficultyTier: "easy",
  sourceRefs: [],
};

const snapshot: FullCatalogSnapshot = {
  version: "test-v1",
  works: [work],
  characters: [character],
};

describe("QuestionScopePage", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.catalogFull.mockReset();
    mocks.push.mockReset();
    mocks.roomInfo.mockReset();
    mocks.catalogFull.mockResolvedValue(snapshot);
  });

  it("renders editable settings as a nested paper-control page", async () => {
    const { container } = render(<QuestionScopePage backHref="/single" />);

    expect(
      await screen.findByRole("heading", { name: "预设难度选择" }),
    ).toBeTruthy();
    const back = screen.getByRole("link", { name: "返回" });
    expect(back.getAttribute("href")).toBe("/single");
    expect(screen.queryByRole("dialog")).toBeNull();

    const titleActions = container.querySelector(".page-header-slot-right");
    expect(
      titleActions?.contains(screen.getByRole("button", { name: "导出" })),
    ).toBe(true);
    expect(
      titleActions?.contains(screen.getByRole("button", { name: "导入" })),
    ).toBe(true);

    const sticky = container.querySelector(".question-scope-toolbar");
    expect(sticky?.contains(screen.getByText("当前难度"))).toBe(true);
    expect(
      sticky?.contains(screen.getByRole("button", { name: "应用设置" })),
    ).toBe(true);
    expect(sticky?.contains(screen.getByRole("button", { name: "取消" }))).toBe(
      true,
    );

    const sections = container.querySelectorAll(".question-scope-section");
    expect(sections).toHaveLength(3);
    expect(
      [...sections].every(
        (section) => !section.classList.contains("paper-surface"),
      ),
    ).toBe(true);
    const presetGroup = screen.getByRole("group", { name: "预设难度选择" });
    expect(within(presetGroup).getAllByRole("radio")).toHaveLength(4);
    expect(
      presetGroup.querySelectorAll(".paper-segment-separator"),
    ).toHaveLength(3);
    for (const label of ["设置单手限时", "设置猜测次数限制"]) {
      const group = screen.getByRole("group", { name: label });
      expect(group.querySelectorAll(".paper-segment-separator")).toHaveLength(
        2,
      );
    }
    expect(screen.getByText("秒")).toBeTruthy();
    const species = screen.getByRole("checkbox", { name: "种族" });
    await userEvent.click(species);
    expect(species.querySelector(".question-scope-empty-square")).toBeTruthy();
    const firstAppearance = screen.getByRole("checkbox", {
      name: "初登场作品",
    });
    expect(firstAppearance.querySelector(".lucide-check")).toBeTruthy();
    expect(
      firstAppearance.querySelector(".question-scope-empty-square"),
    ).toBeNull();
    const releaseYear = screen.getByRole("checkbox", {
      name: "初登场年份",
    });
    const releaseControl = releaseYear.closest(
      ".question-scope-release-control",
    ) as HTMLElement;
    expect(releaseControl.classList.contains("paper-surface")).toBe(false);
    expect(screen.getByText("方向性提示")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "设置单手限时" })).toBeTruthy();
    expect(
      screen.getByRole("slider", { name: "设置单手限时滑块" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("spinbutton", { name: "设置单手限时数值" }),
    ).toBeTruthy();
    const filterHeading = container.querySelector(
      ".question-scope-filter-heading",
    ) as HTMLElement;
    const workTab = screen.getByRole("tab", { name: "按作品筛选" });
    const characterTab = screen.getByRole("tab", { name: "按角色筛选" });
    expect(workTab.getAttribute("aria-selected")).toBe("true");
    expect(characterTab.getAttribute("aria-selected")).toBe("false");
    expect(filterHeading.contains(screen.getByText("已选择 1/1 个角色"))).toBe(
      true,
    );
    expect(
      filterHeading.querySelectorAll(".question-scope-bulk-controls"),
    ).toHaveLength(1);
    expect(container.querySelector(".lucide-search")).toBeNull();
    expect(screen.queryByRole("button", { name: "收起作品筛选" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: /东方红魔乡/ })).toBeTruthy();

    await userEvent.click(characterTab);
    expect(workTab.getAttribute("aria-selected")).toBe("false");
    expect(characterTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("checkbox", { name: /博丽灵梦/ })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "全不选" }));
    expect(screen.getByText("已选择 0/1 个角色")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "全选" }));
    expect(screen.getByText("已选择 1/1 个角色")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "应用设置" }));
    expect(mocks.push).toHaveBeenCalledWith("/single");
    expect(localStorage.getItem(QUESTION_SCOPE_STORAGE_KEY)).toBeTruthy();
  });

  it("loads a room scope as a read-only standalone page", async () => {
    mocks.roomInfo.mockResolvedValue({
      questionScope: normalizeQuestionScope(null, snapshot).config,
    });
    render(<QuestionScopePage backHref="/multi" roomCode="ABC123" />);

    expect(
      await screen.findByRole("heading", { name: "房主题库设置" }),
    ).toBeTruthy();
    await waitFor(() => expect(mocks.roomInfo).toHaveBeenCalledWith("ABC123"));
    expect(screen.queryByRole("button", { name: "导出" })).toBeNull();
    expect(screen.queryByRole("button", { name: "导入" })).toBeNull();
    expect(screen.queryByRole("button", { name: "应用设置" })).toBeNull();
    expect(screen.getByRole("button", { name: "返回" })).toBeTruthy();
  });
});
