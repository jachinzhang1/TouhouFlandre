import type {
  MemberBoardView,
  MemberResultView,
  MemberScoreView,
  MultiMatchResult,
} from "@touhouflandre/shared";

type MemberRef = { memberId: string; seat: number };

export function memberIdAtSeat(
  members: readonly MemberRef[],
  seat: number,
): string | undefined {
  return members.find((member) => member.seat === seat)?.memberId;
}

export function seatForMemberId(
  members: readonly MemberRef[],
  memberId: string | null | undefined,
): number | undefined {
  if (!memberId) return undefined;
  return members.find((member) => member.memberId === memberId)?.seat;
}

export function scoreAtSeat(
  scores: readonly MemberScoreView[] | undefined,
  seat: number,
): number {
  return scores?.find((score) => score.seat === seat)?.score ?? 0;
}

export function boardAtSeat(
  boards: readonly MemberBoardView[] | undefined,
  seat: number,
): MemberBoardView["guesses"] {
  return boards?.find((board) => board.seat === seat)?.guesses ?? [];
}

export function resultForMemberId(
  results: readonly MemberResultView[] | undefined,
  memberId: string | null | undefined,
): MultiMatchResult | undefined {
  if (!memberId) return undefined;
  return results?.find((result) => result.memberId === memberId)?.result;
}

export function resultAtSeat(
  results: readonly MemberResultView[] | undefined,
  seat: number,
): MultiMatchResult | undefined {
  return results?.find((result) => result.seat === seat)?.result;
}
