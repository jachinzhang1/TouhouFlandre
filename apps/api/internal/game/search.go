package game

import (
	"fmt"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// NormalizeSearchText 对应 shared 的 normalizeSearchText：
// 小写 → NFKC 归一化 → 去除空白与符号（_ . ・ · -）。
func NormalizeSearchText(value string) string {
	lowered := strings.Map(unicode.ToLower, value)
	normalized := norm.NFKC.String(lowered)
	var builder strings.Builder
	builder.Grow(len(normalized))
	for _, r := range normalized {
		if unicode.IsSpace(r) || r == '_' || r == '.' || r == '・' || r == '·' || r == '-' {
			continue
		}
		builder.WriteRune(r)
	}
	return builder.String()
}

// CharacterNameSortKey 对应 shared 的 characterNameSortKey（seed 派生用）。
func CharacterNameSortKey(character Character) string {
	name := character.Names.En
	if character.Names.Romaji != nil {
		name = *character.Names.Romaji
	}
	return NormalizeSearchText(name)
}

// CharacterSearchText 对应 shared 的 characterSearchText：拼接全部可搜索字段。
func CharacterSearchText(character Character) string {
	parts := []string{character.Names.ZhHans}
	if character.Names.ZhHant != nil {
		parts = append(parts, *character.Names.ZhHant)
	}
	parts = append(parts, character.Names.Ja, character.Names.En)
	if character.Names.Romaji != nil {
		parts = append(parts, *character.Names.Romaji)
	}
	parts = append(parts, character.Names.Aliases...)
	parts = append(parts, character.FirstAppearance.WorkTitle, character.FirstAppearance.WorkID)
	if character.FirstAppearance.MainlineIndex != nil {
		index := *character.FirstAppearance.MainlineIndex
		parts = append(parts,
			fmt.Sprintf("TH%02d", index),
			fmt.Sprintf("th%02d", index),
		)
	}
	return strings.Join(parts, " ")
}
