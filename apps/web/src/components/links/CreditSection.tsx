"use client";

import { useId, useState } from "react";
import { SectionHeading } from "../layout/SectionHeading";
import { PaperPagination } from "@/components/paper";
import { CreditEntryCard } from "./CreditEntryCard";
import type { CreditSectionDefinition } from "./creditData";

const CREDIT_PAGE_SIZE = 4;

export function CreditSection({ entries, title }: CreditSectionDefinition) {
  const listId = useId();
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(entries.length / CREDIT_PAGE_SIZE));
  const visibleEntries = entries.slice(
    (page - 1) * CREDIT_PAGE_SIZE,
    page * CREDIT_PAGE_SIZE,
  );
  return (
    <section className="mt-9">
      <SectionHeading className="mb-4" title={title} />
      <div id={listId} className="grid max-w-[760px] grid-cols-1 gap-4">
        {visibleEntries.map((entry, index) => (
          <CreditEntryCard
            entry={entry}
            key={entry.title}
            stackOrder={visibleEntries.length - index}
          />
        ))}
      </div>
      {pageCount > 1 ? (
        <PaperPagination
          className="mt-4 w-fit"
          controlsId={listId}
          label={`${title}分页`}
          page={page}
          pageCount={pageCount}
          onPrevious={() => setPage((current) => Math.max(1, current - 1))}
          onNext={() => setPage((current) => Math.min(pageCount, current + 1))}
        />
      ) : null}
    </section>
  );
}
