package multi

import (
	"sort"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	"github.com/jackc/pgx/v5/pgtype"
)

type memberRef struct {
	MemberID string
	Seat     int
}

func orderedMemberRefs(memberSeatByID map[string]int32) []memberRef {
	refs := make([]memberRef, 0, len(memberSeatByID))
	for memberID, seat := range memberSeatByID {
		if seat <= 0 {
			continue
		}
		refs = append(refs, memberRef{MemberID: memberID, Seat: int(seat)})
	}
	sort.Slice(refs, func(i, j int) bool {
		if refs[i].Seat == refs[j].Seat {
			return refs[i].MemberID < refs[j].MemberID
		}
		return refs[i].Seat < refs[j].Seat
	})
	return refs
}

func memberRefForID(memberSeatByID map[string]int32, memberID string) (memberRef, bool) {
	seat, ok := memberSeatByID[memberID]
	return memberRef{MemberID: memberID, Seat: int(seat)}, ok && seat > 0
}

func memberIDForSeat(memberSeatByID map[string]int32, seat int) *string {
	for memberID, memberSeat := range memberSeatByID {
		if int(memberSeat) == seat {
			id := memberID
			return &id
		}
	}
	return nil
}

func MemberScoresForLegacy(scores ScoresView, memberSeatByID map[string]int32) []MemberScoreView {
	views := make([]MemberScoreView, 0, len(memberSeatByID))
	for _, ref := range orderedMemberRefs(memberSeatByID) {
		score := 0
		switch ref.Seat {
		case 1:
			score = scores.Slot1
		case 2:
			score = scores.Slot2
		}
		views = append(views, MemberScoreView{MemberID: ref.MemberID, Seat: ref.Seat, Score: score})
	}
	return views
}

func MemberScoresForRoster(players []repo.MultiMatchPlayer) []MemberScoreView {
	views := make([]MemberScoreView, 0, len(players))
	for _, player := range players {
		views = append(views, MemberScoreView{
			MemberID:        player.MemberID,
			Seat:            int(player.Seat),
			Score:           int(player.Score),
			Status:          player.Status,
			BestRoundScore:  int(player.BestRoundScore),
			EliminatedRound: intPointer(player.EliminatedRound),
		})
	}
	sort.Slice(views, func(i, j int) bool {
		if views[i].Seat == views[j].Seat {
			return views[i].MemberID < views[j].MemberID
		}
		return views[i].Seat < views[j].Seat
	})
	return views
}

func intPointer(value pgtype.Int4) *int {
	if !value.Valid {
		return nil
	}
	result := int(value.Int32)
	return &result
}

func MemberResults(winnerMemberID *string, memberSeatByID map[string]int32) []MemberResultView {
	views := make([]MemberResultView, 0, len(memberSeatByID))
	for _, ref := range orderedMemberRefs(memberSeatByID) {
		result := MatchResultDraw
		if winnerMemberID != nil {
			result = MatchResultLoss
			if ref.MemberID == *winnerMemberID {
				result = MatchResultWin
			}
		}
		views = append(views, MemberResultView{MemberID: ref.MemberID, Seat: ref.Seat, Result: result})
	}
	return views
}

func MemberResultsForRanking(winnerMemberID *string, ranking []MemberRankingView, memberSeatByID map[string]int32) []MemberResultView {
	if winnerMemberID != nil || len(ranking) == 0 {
		return MemberResults(winnerMemberID, memberSeatByID)
	}
	views := make([]MemberResultView, 0, len(ranking))
	for _, entry := range ranking {
		result := MatchResultLoss
		if entry.Rank == 1 {
			result = MatchResultDraw
		}
		views = append(views, MemberResultView{MemberID: entry.MemberID, Seat: entry.Seat, Result: result})
	}
	sort.Slice(views, func(i, j int) bool { return views[i].Seat < views[j].Seat })
	return views
}

func ViewerResultForMember(memberID string, results []MemberResultView) *MatchResult {
	for _, result := range results {
		if result.MemberID == memberID {
			viewerResult := result.Result
			return &viewerResult
		}
	}
	return nil
}
