package game

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
	Kind      SearchMatchKind
	Position  int
	LengthGap int
}

// RankSearchTerms ranks normalized terms against a normalized, non-empty query.
// It returns the best matching term and false when no term contains the query.
func RankSearchTerms(normalizedQuery string, normalizedTerms []string) (SearchMatchRank, bool) {
	query := []rune(normalizedQuery)
	if len(query) == 0 {
		return SearchMatchRank{}, false
	}

	var best SearchMatchRank
	found := false
	for _, value := range normalizedTerms {
		term := []rune(value)
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
			Kind:      kind,
			Position:  position,
			LengthGap: len(term) - len(query),
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
	if left.Position != right.Position {
		return left.Position - right.Position
	}
	return left.LengthGap - right.LengthGap
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
