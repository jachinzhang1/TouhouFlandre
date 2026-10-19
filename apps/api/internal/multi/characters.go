// 内存题库索引与答案池。
package multi

import "github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"

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
