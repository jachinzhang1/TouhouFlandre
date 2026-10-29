// Package catalog adapts persisted catalog snapshots for game consumers.
package catalog

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
)

// CharactersForVersion 读取版本快照并解析角色列表（tx 或 pool 绑定的 Queries 均可）。
func CharactersForVersion(ctx context.Context, q *repo.Queries, version string) ([]game.Character, error) {
	snapshot, err := q.GetSnapshot(ctx, version)
	if err != nil {
		return nil, err
	}
	var characters []game.Character
	if err := json.Unmarshal(snapshot.Characters, &characters); err != nil {
		return nil, fmt.Errorf("decode snapshot %s: %w", version, err)
	}
	return characters, nil
}
