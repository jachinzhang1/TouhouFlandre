import {
  ArrowDownAZ,
  ArrowUpAZ,
  BookType,
  LayoutGrid,
  List,
  ListOrdered,
} from "lucide-react";
import type { ChangeEvent } from "react";
import type { CharacterSort, SortDirection } from "@touhouflandre/shared";
import {
  PaperSearchInput,
  PaperSegmentButton,
  PaperSegmentGroup,
  PaperSegmentSeparator,
} from "@/components/paper";
import type { CharacterView } from "./types";

export function SearchToolbar({
  direction,
  onDirectionChange,
  onQueryChange,
  onSortChange,
  onViewChange,
  query,
  sort,
  view,
}: {
  direction: SortDirection;
  onDirectionChange: (direction: SortDirection) => void;
  onQueryChange: (query: string) => void;
  onSortChange: (sort: CharacterSort) => void;
  onViewChange: (view: CharacterView) => void;
  query: string;
  sort: CharacterSort;
  view: CharacterView;
}) {
  const handleQueryChange = (event: ChangeEvent<HTMLInputElement>) => {
    onQueryChange(event.target.value);
  };

  return (
    <div className="catalog-querybar">
      <PaperSearchInput
        ariaLabel="搜索角色"
        onChange={handleQueryChange}
        placeholder="输入关键词搜索：灵梦 / Reimu / 红白……"
        value={query}
      />
      <div className="catalog-controls" aria-label="角色目录显示设置">
        <ViewControl value={view} onChange={onViewChange} />
        <SortControl value={sort} onChange={onSortChange} />
        <DirectionControl value={direction} onChange={onDirectionChange} />
      </div>
    </div>
  );
}

function ViewControl({
  onChange,
  value,
}: {
  onChange: (view: CharacterView) => void;
  value: CharacterView;
}) {
  return (
    <PaperSegmentGroup label="显示方式">
      <PaperSegmentButton
        active={value === "grid"}
        ariaLabel="图标视图"
        onClick={() => onChange("grid")}
        title="图标视图"
      >
        <LayoutGrid size={17} aria-hidden="true" />
      </PaperSegmentButton>
      <PaperSegmentSeparator />
      <PaperSegmentButton
        active={value === "list"}
        ariaLabel="列表视图"
        onClick={() => onChange("list")}
        title="列表视图"
      >
        <List size={17} aria-hidden="true" />
      </PaperSegmentButton>
    </PaperSegmentGroup>
  );
}

function SortControl({
  onChange,
  value,
}: {
  onChange: (sort: CharacterSort) => void;
  value: CharacterSort;
}) {
  return (
    <PaperSegmentGroup label="排序字段">
      <PaperSegmentButton
        active={value === "appearance"}
        onClick={() => onChange("appearance")}
      >
        <ListOrdered size={17} aria-hidden="true" />
        <span>登场</span>
      </PaperSegmentButton>
      <PaperSegmentSeparator />
      <PaperSegmentButton
        active={value === "name"}
        onClick={() => onChange("name")}
      >
        <BookType size={17} aria-hidden="true" />
        <span>名称</span>
      </PaperSegmentButton>
    </PaperSegmentGroup>
  );
}

function DirectionControl({
  onChange,
  value,
}: {
  onChange: (direction: SortDirection) => void;
  value: SortDirection;
}) {
  return (
    <PaperSegmentGroup label="排序方向">
      <PaperSegmentButton
        active={value === "asc"}
        ariaLabel="正序"
        onClick={() => onChange("asc")}
        title="正序"
      >
        <ArrowDownAZ size={17} aria-hidden="true" />
      </PaperSegmentButton>
      <PaperSegmentSeparator />
      <PaperSegmentButton
        active={value === "desc"}
        ariaLabel="倒序"
        onClick={() => onChange("desc")}
        title="倒序"
      >
        <ArrowUpAZ size={17} aria-hidden="true" />
      </PaperSegmentButton>
    </PaperSegmentGroup>
  );
}
