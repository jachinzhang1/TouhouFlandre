import { SectionHeading } from "../layout/SectionHeading";
import { CreditEntryCard } from "./CreditEntryCard";
import type { CreditSectionDefinition } from "./creditData";

export function CreditSection({ entries, title }: CreditSectionDefinition) {
  return (
    <section className="mt-9">
      <SectionHeading className="mb-4" title={title} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] gap-4">
        {entries.map((entry, index) => (
          <CreditEntryCard
            entry={entry}
            key={entry.title}
            stackOrder={entries.length - index}
          />
        ))}
      </div>
    </section>
  );
}
