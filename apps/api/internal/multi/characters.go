// 题库快照读取（07 §2：按场绑定版本，展示字段在投影时从快照恢复）。
package multi

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

// CharactersByID 角色 id → 角色 索引（猜测校验/棋盘水合用）。
func CharactersByID(characters []game.Character) map[string]game.Character {
	byID := make(map[string]game.Character, len(characters))
	for _, character := range characters {
		byID[character.ID] = character
	}
	return byID
}

// AnswerPool 可答角色池（enabled_as_answer）。
func AnswerPool(characters []game.Character) []string {
	pool := make([]string, 0, len(characters))
	for _, character := range characters {
		if character.EnabledAsAnswer {
			pool = append(pool, character.ID)
		}
	}
	return pool
}
