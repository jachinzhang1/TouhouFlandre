"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PaperButton } from "@/components/paper";

type MemberPageItem = { memberId: string; seat: number };

export function MemberPaginator<T extends MemberPageItem>({
  items,
  label,
  renderItem,
  pageSize: fixedPageSize,
}: {
  items: readonly T[];
  label: string;
  renderItem: (item: T) => ReactNode;
  pageSize?: 1 | 2;
}) {
  const ordered = useMemo(
    () => [...items].sort((left, right) => left.seat - right.seat),
    [items],
  );
  const [wide, setWide] = useState(() =>
    typeof window === "undefined"
      ? true
      : window.matchMedia("(min-width: 900px)").matches,
  );
  const [anchorMemberId, setAnchorMemberId] = useState<string | null>(null);
  const pageSize = fixedPageSize ?? (wide ? 2 : 1);
  const anchorIndex = Math.max(
    0,
    ordered.findIndex((item) => item.memberId === anchorMemberId),
  );
  const pageStart = Math.min(
    anchorIndex,
    Math.max(0, ordered.length - pageSize),
  );
  const visible = ordered.slice(pageStart, pageStart + pageSize);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 900px)");
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (ordered.length === 0) {
      setAnchorMemberId(null);
      return;
    }
    if (!ordered.some((item) => item.memberId === anchorMemberId)) {
      setAnchorMemberId(ordered[0].memberId);
    }
  }, [anchorMemberId, ordered]);

  if (ordered.length === 0) return null;

  const move = (start: number) => {
    const target = ordered[Math.max(0, Math.min(start, ordered.length - 1))];
    if (target) setAnchorMemberId(target.memberId);
  };

  return (
    <div className="min-w-0" data-page-size={pageSize}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[0.78rem] font-bold text-ink-soft">{label}</span>
        <div className="flex items-center gap-1 text-[0.7rem] text-ink-soft">
          <PaperButton
            ariaLabel={`${label}上一页`}
            className="size-8"
            compact
            disabled={pageStart === 0}
            folded={false}
            iconOnly
            onClick={() => move(pageStart - pageSize)}
            title="上一页"
          >
            <ChevronLeft size={15} aria-hidden="true" />
          </PaperButton>
          <span className="min-w-16 text-center tabular-nums">
            {pageStart + 1}-{Math.min(ordered.length, pageStart + pageSize)}/
            {ordered.length}
          </span>
          <PaperButton
            ariaLabel={`${label}下一页`}
            className="size-8"
            compact
            disabled={pageStart + pageSize >= ordered.length}
            folded={false}
            iconOnly
            onClick={() => move(pageStart + pageSize)}
            title="下一页"
          >
            <ChevronRight size={15} aria-hidden="true" />
          </PaperButton>
        </div>
      </div>
      <div
        className={`grid items-start gap-3 ${pageSize === 2 ? "min-[900px]:grid-cols-2" : "grid-cols-1"}`}
      >
        {visible.map((item) => (
          <div key={item.memberId} data-member-board={item.memberId}>
            {renderItem(item)}
          </div>
        ))}
      </div>
    </div>
  );
}
