"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { PaperPagination } from "@/components/paper";

type MemberPageItem = { memberId: string; seat: number };

export function MemberPaginator<T extends MemberPageItem>({
  getPageLabel,
  items,
  label,
  renderHeader,
  renderItem,
  controlsPlacement = "before",
  pageSize: fixedPageSize,
}: {
  getPageLabel?: (context: {
    page: number;
    pageCount: number;
    visibleItems: readonly T[];
  }) => ReactNode;
  items: readonly T[];
  label: string;
  renderHeader?: (context: {
    controls: ReactNode;
    page: number;
    pageCount: number;
    visibleItems: readonly T[];
  }) => ReactNode;
  renderItem: (item: T, controls: ReactNode) => ReactNode;
  pageSize?: 1 | 2;
  controlsPlacement?: "before" | "item";
}) {
  const panelId = useId();
  const ordered = useMemo(
    () => [...items].sort((left, right) => left.seat - right.seat),
    [items],
  );
  const [wide, setWide] = useState(() =>
    typeof window === "undefined"
      ? true
      : window.matchMedia("(min-width: 900px)").matches,
  );
  const [page, setPage] = useState(1);
  const pageSize = fixedPageSize ?? (wide ? 2 : 1);
  const pageCount = Math.max(1, Math.ceil(ordered.length / pageSize));
  const pageStart = (page - 1) * pageSize;
  const visibleItems = ordered.slice(pageStart, pageStart + pageSize);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 900px)");
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  useEffect(() => {
    setPage(1);
  }, [ordered.length, ordered[0]?.memberId, pageSize]);

  if (ordered.length === 0) return null;

  const context = { page, pageCount, visibleItems };
  const controls =
    pageCount > 1 ? (
      <PaperPagination
        className="member-paginator-pagination"
        controlsId={panelId}
        counterLabel={getPageLabel?.(context)}
        label={`${label}翻页`}
        nextLabel={`${label}下一页`}
        onNext={() => setPage((current) => Math.min(pageCount, current + 1))}
        onPrevious={() => setPage((current) => Math.max(1, current - 1))}
        page={page}
        pageCount={pageCount}
        previousLabel={`${label}上一页`}
      />
    ) : null;

  return (
    <div className="member-paginator min-w-0" data-page-size={pageSize}>
      {renderHeader ? (
        renderHeader({ ...context, controls })
      ) : controlsPlacement === "before" && controls ? (
        <div className="member-paginator-controls">{controls}</div>
      ) : null}
      <div
        className={`grid items-start gap-5 ${pageSize === 2 ? "min-[900px]:grid-cols-2" : "grid-cols-1"}`}
        id={panelId}
      >
        {visibleItems.map((item) => (
          <div key={item.memberId} data-member-board={item.memberId}>
            {renderItem(item, controlsPlacement === "item" ? controls : null)}
          </div>
        ))}
      </div>
    </div>
  );
}
