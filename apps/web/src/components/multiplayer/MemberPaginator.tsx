"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PaperPagination } from "@/components/paper";

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
  const [page, setPage] = useState(1);
  const pageSize = fixedPageSize ?? (wide ? 2 : 1);
  const pageCount = Math.max(1, Math.ceil(ordered.length / pageSize));
  const pageStart = (page - 1) * pageSize;
  const visible = ordered.slice(pageStart, pageStart + pageSize);

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

  return (
    <div className="member-paginator min-w-0" data-page-size={pageSize}>
      {pageCount > 1 ? (
        <div className="member-paginator-controls">
          <PaperPagination
            label={`${label}翻页`}
            nextLabel={`${label}下一页`}
            onNext={() =>
              setPage((current) => Math.min(pageCount, current + 1))
            }
            onPrevious={() => setPage((current) => Math.max(1, current - 1))}
            page={page}
            pageCount={pageCount}
            previousLabel={`${label}上一页`}
          />
        </div>
      ) : null}
      <div
        className={`grid items-start gap-5 ${pageSize === 2 ? "min-[900px]:grid-cols-2" : "grid-cols-1"}`}
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
