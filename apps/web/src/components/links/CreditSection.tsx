import { SectionHeading } from "../layout/SectionHeading";
import { CreditEntryCard } from "./CreditEntryCard";
import type { CreditSectionDefinition } from "./creditData";

export function CreditSection({ entries, title }: CreditSectionDefinition) {
  return (
    <section className="mt-9">
      <SectionHeading className="mb-4" title={title} />
      <div className="credit-entry-grid">
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
