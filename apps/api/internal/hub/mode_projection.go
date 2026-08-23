package hub

import (
	"context"
	"encoding/json"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"
)

func (h *Hub) validateModeHistory(ctx context.Context, roomID string) error {
	raw, err := h.q.GetRoomSnapshotState(ctx, roomID)
	if err != nil {
		return err
	}
	var state struct {
		Room struct {
			Mode string `json:"mode"`
		} `json:"room"`
		Match *struct {
			ScoringMode string `json:"scoring_mode"`
		} `json:"match"`
	}
	if err := json.Unmarshal(raw, &state); err != nil {
		return err
	}
	if state.Match == nil {
		return nil
	}
	ref, err := h.modeRegistry.ResolveLegacy(core.Mode(state.Room.Mode), state.Match.ScoringMode)
	if err != nil {
		return err
	}
	reader, err := h.modeRegistry.HistoryReader(ref.Mode)
	if err != nil {
		return err
	}
	_, err = reader.Style(ref)
	return err
}
