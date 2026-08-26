package multi_test

import (
	"testing"
	"time"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
)

func TestSystemAnnouncementWriterDisabledAndSmallRosterAreNoOps(t *testing.T) {
	input := multi.SystemAnnouncement{
		RoomID: "room-1", RosterSize: 2, TriggerKey: "trigger-1", Content: "content", CreatedAt: time.Now(),
	}
	changed, err := multi.NewSystemAnnouncementWriter(false).Append(t.Context(), nil, input)
	if err != nil || changed {
		t.Fatalf("disabled append changed=%t err=%v", changed, err)
	}
	input.RosterSize = 1
	changed, err = multi.NewSystemAnnouncementWriter(true).Append(t.Context(), nil, input)
	if err != nil || changed {
		t.Fatalf("small-roster append changed=%t err=%v", changed, err)
	}
}

func TestSystemAnnouncementClientMessageIDIsDeterministicAndScoped(t *testing.T) {
	first := multi.SystemAnnouncementClientMessageID("room-1", "race/round/member/correct")
	repeated := multi.SystemAnnouncementClientMessageID("room-1", "race/round/member/correct")
	otherRoom := multi.SystemAnnouncementClientMessageID("room-2", "race/round/member/correct")
	otherTrigger := multi.SystemAnnouncementClientMessageID("room-1", "race/round/member/exhausted")
	if !first.Valid || first.Bytes != repeated.Bytes {
		t.Fatal("same room and trigger must produce one valid UUID")
	}
	if first.Bytes == otherRoom.Bytes || first.Bytes == otherTrigger.Bytes {
		t.Fatal("room and trigger must both scope the deterministic UUID")
	}
}

func TestRaceAnnouncementCopyAndTriggerKey(t *testing.T) {
	now := time.Date(2026, 8, 26, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		reason multi.RaceAnnouncementReason
		want   string
	}{
		{multi.RaceAnnouncementCorrect, "[第 3 轮]雾雨魔理沙(P2)已猜中"},
		{multi.RaceAnnouncementExhausted, "[第 3 轮]雾雨魔理沙(P2)猜测次数已耗尽"},
		{multi.RaceAnnouncementForfeited, "[第 3 轮]雾雨魔理沙(P2)已放弃本局"},
		{multi.RaceAnnouncementDisconnect, "[第 3 轮]雾雨魔理沙(P2)已离线"},
	}
	for _, test := range tests {
		announcement, err := (multi.RaceAnnouncement{
			RoomID: "room-1", RoundID: "round-3", RoundIndex: 3, RosterSize: 4,
			MemberID: "member-2", DisplayName: "雾雨魔理沙", Seat: 2,
			Reason: test.reason, CreatedAt: now,
		}).SystemAnnouncement()
		if err != nil {
			t.Fatalf("reason %s: %v", test.reason, err)
		}
		if announcement.Content != test.want {
			t.Fatalf("reason %s content=%q want=%q", test.reason, announcement.Content, test.want)
		}
		if announcement.TriggerKey != "race/round-3/member-2/"+string(test.reason) {
			t.Fatalf("reason %s trigger=%q", test.reason, announcement.TriggerKey)
		}
	}
}
