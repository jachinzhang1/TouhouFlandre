package game

// SearchTermSource identifies the character field that produced a normalized
// term. The wire contract keeps exact sources so priority groups can evolve
// without another index shape change.
type SearchTermSource string

const (
	SearchTermSourceZhHans             SearchTermSource = "zhHans"
	SearchTermSourceZhHant             SearchTermSource = "zhHant"
	SearchTermSourceJa                 SearchTermSource = "ja"
	SearchTermSourceEn                 SearchTermSource = "en"
	SearchTermSourceRomaji             SearchTermSource = "romaji"
	SearchTermSourceAlias              SearchTermSource = "alias"
	SearchTermSourceWorkTitle          SearchTermSource = "workTitle"
	SearchTermSourceWorkID             SearchTermSource = "workId"
	SearchTermSourceWorkPinyinInitials SearchTermSource = "workPinyinInitials"
	SearchTermSourceMainlineIndex      SearchTermSource = "mainlineIndex"
)

type SearchTerm struct {
	Value  string           `json:"value"`
	Source SearchTermSource `json:"source"`
}

// SearchMatchKind is ordered from the strongest to the weakest supported
// contiguous match. The search candidate set remains unchanged.
type SearchMatchKind uint8

const (
	SearchMatchExact SearchMatchKind = iota
	SearchMatchPrefix
	SearchMatchSubstring
)

// SearchMatchRank is compared lexicographically. Lower values are more relevant.
type SearchMatchRank struct {
	Kind          SearchMatchKind
	FieldPriority int
	Position      int
	LengthGap     int
}

// RankSearchTerms ranks normalized terms against a normalized, non-empty query.
// It returns the best matching term and false when no term contains the query.
func RankSearchTerms(normalizedQuery string, normalizedTerms []SearchTerm) (SearchMatchRank, bool) {
	query := []rune(normalizedQuery)
	if len(query) == 0 {
		return SearchMatchRank{}, false
	}

	var best SearchMatchRank
	found := false
	for _, searchTerm := range normalizedTerms {
		term := []rune(searchTerm.Value)
		position := runeSliceIndex(term, query)
		if position < 0 {
			continue
		}
		kind := SearchMatchSubstring
		if position == 0 {
			kind = SearchMatchPrefix
			if len(term) == len(query) {
				kind = SearchMatchExact
			}
		}
		rank := SearchMatchRank{
			Kind:          kind,
			FieldPriority: SearchTermFieldPriority(searchTerm.Source),
			Position:      position,
			LengthGap:     len(term) - len(query),
		}
		if !found || CompareSearchMatchRanks(rank, best) < 0 {
			best = rank
			found = true
		}
	}
	return best, found
}

// CompareSearchMatchRanks returns a negative value when left is more relevant.
func CompareSearchMatchRanks(left, right SearchMatchRank) int {
	if left.Kind != right.Kind {
		return int(left.Kind) - int(right.Kind)
	}
	if left.FieldPriority != right.FieldPriority {
		return left.FieldPriority - right.FieldPriority
	}
	if left.Position != right.Position {
		return left.Position - right.Position
	}
	return left.LengthGap - right.LengthGap
}

// SearchTermFieldPriority maps exact sources into the four product-level
// priority groups. Lower values rank first.
func SearchTermFieldPriority(source SearchTermSource) int {
	switch source {
	case SearchTermSourceZhHans, SearchTermSourceZhHant:
		return 0
	case SearchTermSourceJa, SearchTermSourceEn, SearchTermSourceRomaji:
		return 1
	case SearchTermSourceAlias:
		return 2
	case SearchTermSourceWorkTitle, SearchTermSourceWorkID, SearchTermSourceWorkPinyinInitials, SearchTermSourceMainlineIndex:
		return 3
	default:
		return 4
	}
}

func runeSliceIndex(haystack, needle []rune) int {
	lastStart := len(haystack) - len(needle)
	for start := 0; start <= lastStart; start++ {
		matches := true
		for offset, value := range needle {
			if haystack[start+offset] != value {
				matches = false
				break
			}
		}
		if matches {
			return start
		}
	}
	return -1
}
