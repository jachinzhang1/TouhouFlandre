package game

import (
	"errors"
	"time"
)

// PuzzleTimeZone 对应 shared 的 PUZZLE_TIME_ZONE。
const PuzzleTimeZone = "Asia/Shanghai"

// PuzzleLocation 惰性加载的每日题时区。
var PuzzleLocation = func() *time.Location {
	loc, err := time.LoadLocation(PuzzleTimeZone)
	if err != nil {
		panic("game: failed to load puzzle time zone: " + err.Error())
	}
	return loc
}()

// GetPuzzleDateKey 对应 shared 的 getPuzzleDateKey。
// loc 为 nil 时使用 PuzzleLocation。
func GetPuzzleDateKey(date time.Time, loc *time.Location) string {
	if loc == nil {
		loc = PuzzleLocation
	}
	return date.In(loc).Format("2006-01-02")
}

// hashString 对应 shared 的 hashString（FNV-1a 32 位）。
// 注：TS 的 charCodeAt 是 UTF-16 码元；题库 id/dateKey 均为 BMP 字符，
// 按 rune 处理与之等价。若未来引入补充平面字符需改用 UTF-16 码元。
func HashString(value string) uint32 {
	hash := uint32(2166136261)
	for _, r := range value {
		hash ^= uint32(r)
		hash *= 16777619
	}
	return hash
}

// GetDailyAnswer 对应 shared 的 getDailyAnswer。
func GetDailyAnswer(characters []Character, dateKey string) (Character, error) {
	pool := make([]Character, 0, len(characters))
	for _, character := range characters {
		if character.EnabledAsAnswer {
			pool = append(pool, character)
		}
	}
	if len(pool) == 0 {
		return Character{}, errors.New("daily puzzle requires at least one enabled answer")
	}

	selected := pool[0]
	for _, character := range pool[1:] {
		selectedScore := HashString("touhouflandre:" + dateKey + ":" + selected.ID)
		score := HashString("touhouflandre:" + dateKey + ":" + character.ID)
		if score > selectedScore {
			selected = character
		}
	}
	return selected, nil
}
