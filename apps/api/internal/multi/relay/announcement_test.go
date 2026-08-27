package relay_test

import (
	"testing"
	"time"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/relay"
)

func TestEncounterAnnouncementOrdersSeatsAndFormatsWinner(t *testing.T) {
	winner := "member-2"
	announcement, err := (relay.EncounterAnnouncement{
		RoomID: "room-1", EncounterID: "encounter-1", StageIndex: 4, RosterSize: 6,
		Members: []relay.AnnouncementMember{
			{MemberID: "member-5", DisplayName: "灵梦", Seat: 5},
			{MemberID: "member-2", DisplayName: "魔理沙", Seat: 2},
		},
		WinnerMemberID: &winner, CreatedAt: time.Now(),
	}).SystemAnnouncement()
	if err != nil {
		t.Fatal(err)
	}
	if got, want := announcement.Content, "[第 4 轮][P2 vs P5]魔理沙(P2)胜出"; got != want {
		t.Fatalf("content=%q want=%q", got, want)
	}
	if announcement.TriggerKey != "relay/encounter-1/ended" {
		t.Fatalf("trigger=%q", announcement.TriggerKey)
	}
}

func TestEncounterAnnouncementFormatsDraw(t *testing.T) {
	announcement, err := (relay.EncounterAnnouncement{
		RoomID: "room-1", EncounterID: "encounter-1", StageIndex: 1, RosterSize: 2,
		Members: []relay.AnnouncementMember{
			{MemberID: "member-1", DisplayName: "A", Seat: 1},
			{MemberID: "member-2", DisplayName: "B", Seat: 2},
		},
		CreatedAt: time.Now(),
	}).SystemAnnouncement()
	if err != nil {
		t.Fatal(err)
	}
	if got, want := announcement.Content, "[第 1 轮][P1 vs P2]双方平局"; got != want {
		t.Fatalf("content=%q want=%q", got, want)
	}
}

func TestEncounterAnnouncementRejectsUnknownWinner(t *testing.T) {
	winner := "other"
	_, err := (relay.EncounterAnnouncement{
		RoomID: "room-1", EncounterID: "encounter-1", StageIndex: 1, RosterSize: 2,
		Members: []relay.AnnouncementMember{
			{MemberID: "member-1", DisplayName: "A", Seat: 1},
			{MemberID: "member-2", DisplayName: "B", Seat: 2},
		},
		WinnerMemberID: &winner, CreatedAt: time.Now(),
	}).SystemAnnouncement()
	if err == nil {
		t.Fatal("unknown winner must be rejected")
	}
}
