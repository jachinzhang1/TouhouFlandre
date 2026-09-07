package game

import "strings"

// ParsedSearchQuery is syntax-only. Its fields are trimmed but otherwise raw.
type ParsedSearchQuery struct {
	Scoped        bool
	Text          string
	CharacterText string
	WorkText      string
}

// ParseSearchQuery splits on the first ASCII at sign. Full-width variants are
// ordinary query content and are not treated as separators.
func ParseSearchQuery(input string) ParsedSearchQuery {
	characterText, workText, scoped := strings.Cut(input, "@")
	if !scoped {
		return ParsedSearchQuery{Text: strings.TrimSpace(input)}
	}
	return ParsedSearchQuery{
		Scoped:        true,
		CharacterText: strings.TrimSpace(characterText),
		WorkText:      strings.TrimSpace(workText),
	}
}
