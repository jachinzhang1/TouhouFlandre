import { CreditEntryCard } from "./CreditEntryCard";
import type { CreditSectionDefinition } from "./creditData";

export function CreditSection({ entries, title }: CreditSectionDefinition) {
  return (
    <section className="mt-9">
      <div className="mb-4 flex items-center gap-[clamp(10px,2vw,18px)]">
        <span className="credit-section-rule" aria-hidden="true" />
        <h2 className="m-0 shrink-0 text-center font-brand text-[1.35rem] font-bold leading-[1.25] text-ink">
          {title}
        </h2>
        <span
          className="credit-section-rule credit-section-rule-right"
          aria-hidden="true"
        />
      </div>
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
