import type {
  MemberBoardView,
  MemberResultView,
  MemberScoreView,
  MultiMatchResult,
} from "@touhouflandre/shared";

type MemberRef = { memberId: string; seat: number };

const bySeat = (a: MemberRef, b: MemberRef) => a.seat - b.seat;

export function sortMembersBySeat<T extends MemberRef>(
  members: readonly T[] | undefined,
): T[] {
  return [...(members ?? [])].sort(bySeat);
}

export function memberForMemberId<T extends MemberRef>(
  members: readonly T[] | undefined,
  memberId: string | null | undefined,
): T | undefined {
  return memberId
    ? members?.find((member) => member.memberId === memberId)
    : undefined;
}

export function seatForMemberId(
  members: readonly MemberRef[],
  memberId: string | null | undefined,
): number | undefined {
  if (!memberId) return undefined;
  return members.find((member) => member.memberId === memberId)?.seat;
}

export function scoreForMemberId(
  scores: readonly MemberScoreView[] | undefined,
  memberId: string | null | undefined,
): number {
  return memberForMemberId(scores, memberId)?.score ?? 0;
}

export function boardForMemberId(
  boards: readonly MemberBoardView[] | undefined,
  memberId: string | null | undefined,
): MemberBoardView["guesses"] {
  return memberForMemberId(boards, memberId)?.guesses ?? [];
}

export function resultForMemberId(
  results: readonly MemberResultView[] | undefined,
  memberId: string | null | undefined,
): MultiMatchResult | undefined {
  if (!memberId) return undefined;
  return results?.find((result) => result.memberId === memberId)?.result;
}
