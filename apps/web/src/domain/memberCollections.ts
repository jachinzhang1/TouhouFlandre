import type {
  MemberBoardView,
  MemberResultView,
  MemberScoreView,
  MultiMatchResult,
  RoundEndedPayload,
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

export function isActiveMatchMember(
  scores: readonly MemberScoreView[] | undefined,
  memberId: string | null | undefined,
): boolean {
  if (!memberId) return false;
  const score = memberForMemberId(scores, memberId);
  return !score || score.status === undefined || score.status === "active";
}

export function isRoundArchiveParticipant(
  archive: Pick<RoundEndedPayload, "placements">,
  memberId: string | null | undefined,
): boolean {
  if (!memberId) return false;
  if (!archive.placements?.length) return true;
  return archive.placements.some((entry) => entry.memberId === memberId);
}

export function resultForMemberId(
  results: readonly MemberResultView[] | undefined,
  memberId: string | null | undefined,
): MultiMatchResult | undefined {
  if (!memberId) return undefined;
  return results?.find((result) => result.memberId === memberId)?.result;
}
