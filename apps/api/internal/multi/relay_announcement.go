package multi

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
)

type RelayAnnouncementMember struct {
	MemberID    string
	DisplayName string
	Seat        int
}

// RelayEncounterAnnouncement is shared by the encounter engine and the
// upgrade-only legacy round path. EncounterID is the authoritative terminal
// unit ID: an encounter ID for current storage, or a round ID for legacy data.
type RelayEncounterAnnouncement struct {
	RoomID         string
	EncounterID    string
	StageIndex     int
	RosterSize     int
	Members        []RelayAnnouncementMember
	WinnerMemberID *string
	CreatedAt      time.Time
}

func (a RelayEncounterAnnouncement) SystemAnnouncement() (SystemAnnouncement, error) {
	if a.RoomID == "" || a.EncounterID == "" || a.StageIndex < 1 || len(a.Members) != 2 {
		return SystemAnnouncement{}, fmt.Errorf("relay announcement: invalid input")
	}
	members := append([]RelayAnnouncementMember(nil), a.Members...)
	sort.Slice(members, func(i, j int) bool {
		if members[i].Seat == members[j].Seat {
			return members[i].MemberID < members[j].MemberID
		}
		return members[i].Seat < members[j].Seat
	})
	for _, member := range members {
		if member.MemberID == "" || member.DisplayName == "" || member.Seat < 1 {
			return SystemAnnouncement{}, fmt.Errorf("relay announcement: invalid member")
		}
	}
	prefix := fmt.Sprintf("[第 %d 轮][P%d vs P%d]", a.StageIndex, members[0].Seat, members[1].Seat)
	content := prefix + "双方平局"
	if a.WinnerMemberID != nil {
		var winner *RelayAnnouncementMember
		for i := range members {
			if members[i].MemberID == *a.WinnerMemberID {
				winner = &members[i]
				break
			}
		}
		if winner == nil {
			return SystemAnnouncement{}, fmt.Errorf("relay announcement: winner is not assigned")
		}
		content = fmt.Sprintf("%s%s(P%d)胜出", prefix, winner.DisplayName, winner.Seat)
	}
	return SystemAnnouncement{
		RoomID: a.RoomID, RosterSize: a.RosterSize,
		TriggerKey: "relay/" + a.EncounterID + "/ended",
		Content:    content, CreatedAt: a.CreatedAt,
	}, nil
}

// LegacyRelayRoundAnnouncement hydrates the frozen two-player roster for an
// active pre-encounter relay round and delegates copy generation to the same
// formatter used by the encounter engine.
func LegacyRelayRoundAnnouncement(ctx context.Context, q *repo.Queries, round repo.MultiRound, match repo.MultiMatch, winnerSlot int, createdAt time.Time) (SystemAnnouncement, error) {
	players, err := q.ListMatchPlayers(ctx, match.ID)
	if err != nil {
		return SystemAnnouncement{}, err
	}
	members := make([]RelayAnnouncementMember, 0, len(players))
	var winnerMemberID *string
	for _, player := range players {
		member, err := q.GetMember(ctx, player.MemberID)
		if err != nil {
			return SystemAnnouncement{}, err
		}
		members = append(members, RelayAnnouncementMember{
			MemberID: member.ID, DisplayName: member.DisplayName, Seat: int(player.Seat),
		})
		if winnerSlot != 0 && int(player.Seat) == winnerSlot {
			id := player.MemberID
			winnerMemberID = &id
		}
	}
	if winnerSlot != 0 && winnerMemberID == nil {
		return SystemAnnouncement{}, fmt.Errorf("relay announcement: winner seat is not assigned")
	}
	return (RelayEncounterAnnouncement{
		RoomID: match.RoomID, EncounterID: round.ID, StageIndex: int(round.RoundIndex),
		RosterSize: int(match.RosterSize), Members: members,
		WinnerMemberID: winnerMemberID, CreatedAt: createdAt,
	}).SystemAnnouncement()
}

func AppendLegacyRelayRoundAnnouncement(ctx context.Context, q *repo.Queries, writer *SystemAnnouncementWriter, round repo.MultiRound, match repo.MultiMatch, winnerSlot int, createdAt time.Time) (bool, error) {
	if writer == nil || !writer.Enabled() || int(match.RosterSize) < MinPlayers {
		return false, nil
	}
	announcement, err := LegacyRelayRoundAnnouncement(ctx, q, round, match, winnerSlot, createdAt)
	if err != nil {
		return false, err
	}
	return writer.Append(ctx, q, announcement)
}
