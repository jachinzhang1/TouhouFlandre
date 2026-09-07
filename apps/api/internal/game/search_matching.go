package game

import "strings"

type SearchTermDomain uint8

const (
	SearchTermDomainCharacter SearchTermDomain = iota
	SearchTermDomainWork
)

func SearchTermDomainForSource(source SearchTermSource) (SearchTermDomain, bool) {
	switch source {
	case SearchTermSourceZhHans,
		SearchTermSourceZhHant,
		SearchTermSourceJa,
		SearchTermSourceEn,
		SearchTermSourceRomaji,
		SearchTermSourceAlias:
		return SearchTermDomainCharacter, true
	case SearchTermSourceWorkTitle,
		SearchTermSourceWorkID,
		SearchTermSourceWorkPinyinInitials,
		SearchTermSourceMainlineIndex:
		return SearchTermDomainWork, true
	default:
		return 0, false
	}
}

func normalizeParsedSearchQuery(query ParsedSearchQuery) ParsedSearchQuery {
	if !query.Scoped {
		query.Text = NormalizeSearchText(query.Text)
		return query
	}
	query.CharacterText = NormalizeSearchText(query.CharacterText)
	query.WorkText = NormalizeSearchText(query.WorkText)
	return query
}

func searchTermsForDomain(terms []SearchTerm, domain SearchTermDomain) []SearchTerm {
	filtered := make([]SearchTerm, 0, len(terms))
	for _, term := range terms {
		if actual, ok := SearchTermDomainForSource(term.Source); ok && actual == domain {
			filtered = append(filtered, term)
		}
	}
	return filtered
}

func matchesSearchTerm(query string, terms []SearchTerm, domain *SearchTermDomain) bool {
	for _, term := range terms {
		if domain != nil {
			actual, ok := SearchTermDomainForSource(term.Source)
			if !ok || actual != *domain {
				continue
			}
		}
		if strings.Contains(term.Value, query) {
			return true
		}
	}
	return false
}

func matchesSearchQuery(query ParsedSearchQuery, terms []SearchTerm) bool {
	if !query.Scoped {
		if query.Text == "" {
			return true
		}
		characterDomain := SearchTermDomainCharacter
		return matchesSearchTerm(query.Text, terms, &characterDomain)
	}
	if query.CharacterText == "" && query.WorkText == "" {
		return false
	}
	characterDomain := SearchTermDomainCharacter
	workDomain := SearchTermDomainWork
	return (query.CharacterText == "" || matchesSearchTerm(query.CharacterText, terms, &characterDomain)) &&
		(query.WorkText == "" || matchesSearchTerm(query.WorkText, terms, &workDomain))
}
