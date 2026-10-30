import { Paper } from "@/components/paper";
import type { CreditEntry } from "./creditData";

export function CreditEntryCard({
  entry,
  stackOrder,
}: {
  entry: CreditEntry;
  stackOrder: number;
}) {
  return (
    <Paper
      as="article"
      className="credit-entry-card grid min-h-[96px] grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-4 p-4 font-brand"
      foldSize={18}
      stackOrder={stackOrder}
      variant="plain"
    >
      <CreditAvatar avatarUrl={entry.avatarUrl} />
      <span className="grid min-w-0">
        <strong className="text-[1.05rem] font-bold leading-[1.4]">
          {entry.title}
        </strong>
        <span className="mt-1 text-[0.78rem] leading-[1.5] text-ink-soft">
          {entry.subtitle}
        </span>
      </span>
      <span className="credit-entry-actions flex shrink-0 items-center gap-2">
        {entry.links.map(({ className, href, Icon, name }) => (
          <a
            aria-label={`${entry.title} 的 ${name} 主页`}
            className={`brand-icon-link ${className} inline-flex size-11 items-center justify-center no-underline hover:-translate-y-px focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[var(--focus-ring)]`}
            href={href}
            key={href}
            rel="noreferrer"
            target="_blank"
            title={`${entry.title} - ${name}`}
          >
            <Icon size={22} aria-hidden="true" />
          </a>
        ))}
      </span>
    </Paper>
  );
}

function CreditAvatar({ avatarUrl }: { avatarUrl?: string }) {
  if (!avatarUrl) return <span className="credit-avatar" aria-hidden="true" />;

  return (
    <span className="credit-avatar" aria-hidden="true">
      <img
        alt=""
        decoding="async"
        referrerPolicy="no-referrer"
        src={avatarUrl}
      />
    </span>
  );
}
