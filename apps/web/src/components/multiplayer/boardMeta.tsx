import type { ReactNode } from "react";

type BoardMember = {
  displayName?: string | null;
};

export function formatBoardTitle(
  member: BoardMember | undefined,
  seat: number,
): string {
  return `${member?.displayName ?? `玩家 ${seat}`}(P${seat})`;
}

export function boardResultBadges({
  winner,
  eliminated,
}: {
  winner: boolean;
  eliminated: boolean;
}): ReactNode {
  if (!winner && !eliminated) return null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {winner ? (
        <span className="rounded bg-jade-soft px-2 py-0.5 text-[0.68rem] font-black text-jade">
          胜利
        </span>
      ) : null}
      {eliminated ? (
        <span className="rounded bg-vermilion-soft px-2 py-0.5 text-[0.68rem] font-black text-vermilion">
          淘汰
        </span>
      ) : null}
    </span>
  );
}
