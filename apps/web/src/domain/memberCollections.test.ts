import { describe, expect, it } from "vitest";
import type { MemberScoreView, RoundEndedPayload } from "@touhouflandre/shared";
import {
  isActiveMatchMember,
  isRoundArchiveParticipant,
} from "./memberCollections";

describe("memberCollections multiplayer visibility helpers", () => {
  it("treats only active or legacy members as currently visible", () => {
    const scores: MemberScoreView[] = [
      { memberId: "active", seat: 1, score: 4, status: "active" },
      { memberId: "legacy", seat: 2, score: 3 },
      { memberId: "eliminated", seat: 3, score: 1, status: "eliminated" },
      { memberId: "left", seat: 4, score: 0, status: "left" },
    ];

    expect(isActiveMatchMember(scores, "active")).toBe(true);
    expect(isActiveMatchMember(scores, "legacy")).toBe(true);
    expect(isActiveMatchMember(scores, "eliminated")).toBe(false);
    expect(isActiveMatchMember(scores, "left")).toBe(false);
  });

  it("uses archive placements as the participants for that historical round", () => {
    const archive = {
      placements: [
        {
          memberId: "active-that-round",
          seat: 1,
          status: "correct",
          pointsAwarded: 2,
        },
      ],
    } satisfies Pick<RoundEndedPayload, "placements">;

    expect(isRoundArchiveParticipant(archive, "active-that-round")).toBe(true);
    expect(isRoundArchiveParticipant(archive, "already-eliminated")).toBe(false);
    expect(isRoundArchiveParticipant({}, "legacy-round")).toBe(true);
  });
});
