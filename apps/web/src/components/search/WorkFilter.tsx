import { useMemo } from "react";
import { Filter } from "lucide-react";
import type { Work } from "@touhouflandre/shared";
import {
  FixedTagCombobox,
  type FixedTagComboboxOption,
} from "../controls/FixedTagCombobox";
import {
  PaperSegmentButton,
  PaperSegmentGroup,
  PaperSegmentSeparator,
} from "../controls/PaperSegmentedControl";
import type { WorkFilterMode } from "./types";

export function WorkFilter({
  mode,
  onModeChange,
  onSelectedWorkIdsChange,
  selectedWorkIds,
  works,
}: {
  mode: WorkFilterMode;
  onModeChange: (mode: WorkFilterMode) => void;
  onSelectedWorkIdsChange: (ids: string[]) => void;
  selectedWorkIds: readonly string[];
  works: Work[];
}) {
  const options = useMemo<FixedTagComboboxOption[]>(
    () =>
      works.map((work) => ({
        id: work.id,
        label: work.titleZh,
        searchText: [
          work.id,
          work.titleZh,
          work.titleJa,
          work.titleEn,
          work.shortName,
          work.pinyinInitials.join(" "),
          String(work.releaseYear),
        ]
          .filter(Boolean)
          .join(" "),
        title: work.titleZh,
        subtitle: `${work.shortName} · ${work.releaseYear}`,
      })),
    [works],
  );

  return (
    <div className="catalog-work-tag-filter">
      <FixedTagCombobox
        ariaLabel="筛选作品"
        clearLabel="清除"
        emptyMessage={works.length ? "没有匹配的作品" : "正在读取作品列表"}
        icon={Filter}
        onSelectedIdsChange={onSelectedWorkIdsChange}
        options={options}
        placeholder="输入作品名称、编号或年份…"
        selectedIds={selectedWorkIds}
        inputWidth={320}
      />
      <PaperSegmentGroup label="作品筛选方式">
        <PaperSegmentButton
          active={mode === "whitelist"}
          onClick={() => onModeChange("whitelist")}
        >
          只看已选作品
        </PaperSegmentButton>
        <PaperSegmentSeparator />
        <PaperSegmentButton
          active={mode === "blacklist"}
          onClick={() => onModeChange("blacklist")}
        >
          排除已选作品
        </PaperSegmentButton>
      </PaperSegmentGroup>
    </div>
  );
}
