package hub

import (
	"context"
	"encoding/json"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
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
			ScoringMode        string          `json:"scoring_mode"`
			RuleSetKey         string          `json:"rule_set_key"`
			RuleSetVersion     int32           `json:"rule_set_version"`
			RuleConfigSnapshot json.RawMessage `json:"rule_config_snapshot"`
		} `json:"match"`
	}
	if err := json.Unmarshal(raw, &state); err != nil {
		return err
	}
	if state.Match == nil {
		return nil
	}
	ref, err := multi.ResolveMatchRuleSet(h.modeRegistry,
		repo.MultiRoom{Mode: state.Room.Mode},
		repo.MultiMatch{
			ScoringMode: state.Match.ScoringMode, RuleSetKey: state.Match.RuleSetKey,
			RuleSetVersion: state.Match.RuleSetVersion, RuleConfigSnapshot: state.Match.RuleConfigSnapshot,
		})
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
