package game

import (
	"fmt"
	"sort"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// NormalizeSearchText applies the shared search normalization to one value.
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

func CharacterNameSortKey(character Character) string {
	name := character.Names.En
	if character.Names.Romaji != nil {
		name = *character.Names.Romaji
	}
	return NormalizeSearchText(name)
}

// CharacterSearchTerms normalizes each searchable field independently. A
// query must match one term, so adjacent fields can never create a match.
func CharacterSearchTerms(character Character) []string {
	values := []string{character.Names.ZhHans}
	if character.Names.ZhHant != nil {
		values = append(values, *character.Names.ZhHant)
	}
	values = append(values, character.Names.Ja, character.Names.En)
	if character.Names.Romaji != nil {
		values = append(values, *character.Names.Romaji)
	}
	values = append(values, character.Names.Aliases...)
	values = append(values,
		character.FirstAppearance.WorkTitle,
		character.FirstAppearance.WorkID,
	)
	values = append(values, character.FirstAppearance.WorkPinyinInitials...)
	if character.FirstAppearance.MainlineIndex != nil {
		values = append(values, fmt.Sprintf("TH%02d", *character.FirstAppearance.MainlineIndex))
	}

	terms := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		term := NormalizeSearchText(value)
		if term == "" {
			continue
		}
		if _, exists := seen[term]; exists {
			continue
		}
		seen[term] = struct{}{}
		terms = append(terms, term)
	}
	return terms
}

// CharacterSearchText is retained for the deprecated catalog search payload.
// Spaces are intentional field boundaries and are never removed here.
func CharacterSearchText(character Character) string {
	return strings.Join(CharacterSearchTerms(character), " ")
}

func MatchCharacterQuery(character Character, query string) bool {
	normalizedQuery := NormalizeSearchText(query)
	if normalizedQuery == "" {
		return true
	}
	for _, term := range CharacterSearchTerms(character) {
		if strings.Contains(term, normalizedQuery) {
			return true
		}
	}
	return false
}

type CharacterSearchOptions struct {
	Query      string
	Filters    []CharacterSearchFilter
	SortBy     string
	Descending bool
	Offset     int
	Limit      int
}

// CharacterSearchFilter is one independently composable search restriction.
// SearchCharacters applies every configured filter before matching and paging.
type CharacterSearchFilter func(Character) bool

func EnabledAsGuessSearchFilter() CharacterSearchFilter {
	return func(character Character) bool {
		return character.EnabledAsGuess
	}
}

func CharacterIDsSearchFilter(characterIDs []string) CharacterSearchFilter {
	allowed := make(map[string]struct{}, len(characterIDs))
	for _, characterID := range characterIDs {
		if characterID != "" {
			allowed[characterID] = struct{}{}
		}
	}
	return func(character Character) bool {
		_, ok := allowed[character.ID]
		return ok
	}
}

func WorkIDsSearchFilter(workIDs []string) CharacterSearchFilter {
	allowed := make(map[string]struct{}, len(workIDs))
	for _, workID := range workIDs {
		if workID != "" {
			allowed[workID] = struct{}{}
		}
	}
	return func(character Character) bool {
		_, ok := allowed[character.FirstAppearance.WorkID]
		return ok
	}
}

func matchesCharacterSearchFilters(character Character, filters []CharacterSearchFilter) bool {
	for _, filter := range filters {
		if filter != nil && !filter(character) {
			return false
		}
	}
	return true
}

type CharacterSearchPage struct {
	Characters []Character
	Total      int
}

// SearchCharacters is the only authoritative character search implementation.
func SearchCharacters(characters []Character, options CharacterSearchOptions) CharacterSearchPage {
	matches := make([]Character, 0, len(characters))
	for _, character := range characters {
		if matchesCharacterSearchFilters(character, options.Filters) && MatchCharacterQuery(character, options.Query) {
			matches = append(matches, character)
		}
	}

	sort.Slice(matches, func(i, j int) bool {
		left, right := matches[i], matches[j]
		comparison := 0
		if options.SortBy == "appearance" {
			comparison = left.AppearanceOrder - right.AppearanceOrder
		} else {
			comparison = strings.Compare(CharacterNameSortKey(left), CharacterNameSortKey(right))
		}
		if comparison == 0 {
			return left.ID < right.ID
		}
		if options.Descending {
			return comparison > 0
		}
		return comparison < 0
	})

	total := len(matches)
	start := max(options.Offset, 0)
	if start > total {
		start = total
	}
	end := total
	if options.Limit >= 0 {
		end = min(start+options.Limit, total)
	}
	return CharacterSearchPage{Characters: matches[start:end], Total: total}
}
