package multi

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
)

const (
	SystemChatMemberID    = "system"
	SystemChatDisplayName = "系统"
)

var systemAnnouncementNamespace = uuid.MustParse("9a6c2eaf-f56a-50a4-a82c-c5bc77fb8f4f")

type ChatSenderRole string

const (
	ChatSenderRolePlayer    ChatSenderRole = "player"
	ChatSenderRoleSpectator ChatSenderRole = "spectator"
	ChatSenderRoleSystem    ChatSenderRole = "system"
)

type SystemAnnouncement struct {
	RoomID     string
	RosterSize int
	TriggerKey string
	Content    string
	CreatedAt  time.Time
}

// SystemAnnouncementWriter persists trusted server-authored text into the
// independent chat stream. Gameplay modules own trigger selection and copy.
type SystemAnnouncementWriter struct {
	enabled bool
}

func NewSystemAnnouncementWriter(enabled bool) *SystemAnnouncementWriter {
	return &SystemAnnouncementWriter{enabled: enabled}
}

func (w *SystemAnnouncementWriter) Enabled() bool {
	return w != nil && w.enabled
}

func (w *SystemAnnouncementWriter) Append(ctx context.Context, q *repo.Queries, input SystemAnnouncement) (bool, error) {
	if !w.Enabled() || input.RosterSize < MinPlayers {
		return false, nil
	}
	if q == nil || input.RoomID == "" || input.TriggerKey == "" || input.Content == "" || input.CreatedAt.IsZero() {
		return false, errors.New("system announcement: incomplete input")
	}

	// Serialize system and member-authored chat positions on the room row.
	if _, err := q.GetRoomForUpdate(ctx, input.RoomID); err != nil {
		return false, err
	}
	clientMessageID := SystemAnnouncementClientMessageID(input.RoomID, input.TriggerKey)
	existing, err := q.GetChatMessageByIdempotency(ctx, repo.GetChatMessageByIdempotencyParams{
		RoomID: input.RoomID, SenderMemberID: SystemChatMemberID, ClientMessageID: clientMessageID,
	})
	if err == nil {
		if existing.Content != input.Content || existing.SenderRole != string(ChatSenderRoleSystem) {
			return false, fmt.Errorf("system announcement: trigger key %q conflicts with persisted content", input.TriggerKey)
		}
		return false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return false, err
	}

	position, err := q.IncrementRoomChatSeq(ctx, input.RoomID)
	if err != nil {
		return false, err
	}
	_, err = q.InsertChatMessage(ctx, repo.InsertChatMessageParams{
		ID:                NewID(),
		RoomID:            input.RoomID,
		Position:          position,
		SenderMemberID:    SystemChatMemberID,
		SenderDisplayName: SystemChatDisplayName,
		SenderRole:        string(ChatSenderRoleSystem),
		SenderSeat:        pgtype.Int4{},
		ClientMessageID:   clientMessageID,
		Kind:              string(ChatKindText),
		Content:           input.Content,
		Channel:           string(ChatChannelRoom),
		CreatedAt:         pgtype.Timestamptz{Time: input.CreatedAt.UTC(), Valid: true},
	})
	if err != nil {
		return false, err
	}
	return true, nil
}

func SystemAnnouncementClientMessageID(roomID, triggerKey string) pgtype.UUID {
	value := uuid.NewSHA1(systemAnnouncementNamespace, []byte(roomID+"\x00"+triggerKey))
	return pgtype.UUID{Bytes: [16]byte(value), Valid: true}
}
