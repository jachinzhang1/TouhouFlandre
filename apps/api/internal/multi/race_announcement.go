package multi

import (
	"fmt"
	"time"
)

type RaceAnnouncementReason string

const (
	RaceAnnouncementCorrect    RaceAnnouncementReason = "correct"
	RaceAnnouncementExhausted  RaceAnnouncementReason = "exhausted"
	RaceAnnouncementForfeited  RaceAnnouncementReason = "forfeited"
	RaceAnnouncementDisconnect RaceAnnouncementReason = "disconnect"
)

type RaceAnnouncement struct {
	RoomID      string
	RoundID     string
	RoundIndex  int
	RosterSize  int
	MemberID    string
	DisplayName string
	Seat        int
	Reason      RaceAnnouncementReason
	CreatedAt   time.Time
}

func (a RaceAnnouncement) SystemAnnouncement() (SystemAnnouncement, error) {
	suffix, ok := map[RaceAnnouncementReason]string{
		RaceAnnouncementCorrect:    "已猜中",
		RaceAnnouncementExhausted:  "猜测次数已耗尽",
		RaceAnnouncementForfeited:  "已放弃本局",
		RaceAnnouncementDisconnect: "已离线",
	}[a.Reason]
	if !ok || a.RoomID == "" || a.RoundID == "" || a.RoundIndex < 1 || a.MemberID == "" || a.DisplayName == "" || a.Seat < 1 {
		return SystemAnnouncement{}, fmt.Errorf("race announcement: invalid input")
	}
	return SystemAnnouncement{
		RoomID: a.RoomID, RosterSize: a.RosterSize,
		TriggerKey: fmt.Sprintf("race/%s/%s/%s", a.RoundID, a.MemberID, a.Reason),
		Content:    fmt.Sprintf("[第 %d 轮]%s(P%d)%s", a.RoundIndex, a.DisplayName, a.Seat, suffix),
		CreatedAt:  a.CreatedAt,
	}, nil
}
