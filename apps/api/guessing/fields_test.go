package guessing_test

import (
	"reflect"
	"testing"

	"github.com/TouhouFlandre/touhouflandre/apps/api/guessing"
)

func TestFieldFeedback(t *testing.T) {
	for _, test := range []struct {
		name   string
		field  guessing.FieldRule
		change func(*guessing.Character)
		want   guessing.FeedbackStatus
	}{
		{"same work", guessing.FieldRule{Key: guessing.FieldFirstAppearance}, func(*guessing.Character) {}, guessing.FeedbackExact},
		{"same medium", guessing.FieldRule{Key: guessing.FieldFirstAppearance}, func(c *guessing.Character) { c.FirstAppearance.WorkID = "another" }, guessing.FeedbackPartial},
		{"different medium", guessing.FieldRule{Key: guessing.FieldFirstAppearance}, func(c *guessing.Character) {
			c.FirstAppearance.WorkID, c.FirstAppearance.WorkType = "another", "book"
		}, guessing.FeedbackMiss},
		{"unknown medium", guessing.FieldRule{Key: guessing.FieldFirstAppearance}, func(c *guessing.Character) {
			c.FirstAppearance.WorkID, c.FirstAppearance.WorkType = "another", "unknown"
		}, guessing.FeedbackMiss},
		{"unknown work", guessing.FieldRule{Key: guessing.FieldFirstAppearance}, func(c *guessing.Character) { c.FirstAppearance.WorkID = "未知" }, guessing.FeedbackUnknown},
		{"same year", guessing.FieldRule{Key: guessing.FieldReleaseYear}, func(*guessing.Character) {}, guessing.FeedbackExact},
		{"answer higher", guessing.FieldRule{Key: guessing.FieldReleaseYear}, func(c *guessing.Character) { c.FirstAppearance.ReleaseYear-- }, guessing.FeedbackHigher},
		{"answer lower", guessing.FieldRule{Key: guessing.FieldReleaseYear}, func(c *guessing.Character) { c.FirstAppearance.ReleaseYear++ }, guessing.FeedbackLower},
		{"exact year only", guessing.FieldRule{Key: guessing.FieldReleaseYear, CompareStrategy: "numberExact"}, func(c *guessing.Character) { c.FirstAppearance.ReleaseYear-- }, guessing.FeedbackMiss},
		{"unknown year", guessing.FieldRule{Key: guessing.FieldReleaseYear}, func(c *guessing.Character) { c.FirstAppearance.ReleaseYear = 0 }, guessing.FeedbackUnknown},
		{"set ordering and duplicates", guessing.FieldRule{Key: guessing.FieldSpecies}, func(c *guessing.Character) { c.Species = []string{"youkai", "magician", "youkai"} }, guessing.FeedbackExact},
		{"set overlap", guessing.FieldRule{Key: guessing.FieldSpecies}, func(c *guessing.Character) { c.Species = []string{"magician", "other"} }, guessing.FeedbackPartial},
		{"disjoint sets", guessing.FieldRule{Key: guessing.FieldSpecies}, func(c *guessing.Character) { c.Species = []string{"human"} }, guessing.FeedbackMiss},
		{"empty set", guessing.FieldRule{Key: guessing.FieldSpecies}, func(c *guessing.Character) { c.Species = nil }, guessing.FeedbackUnknown},
		{"partially unknown set", guessing.FieldRule{Key: guessing.FieldSpecies}, func(c *guessing.Character) { c.Species = []string{"magician", "unknown"} }, guessing.FeedbackUnknown},
		{"unsupported ability field", guessing.FieldRule{Key: "abilityTags"}, func(*guessing.Character) {}, guessing.FeedbackUnknown},
		{"unsupported roles field", guessing.FieldRule{Key: "roles"}, func(*guessing.Character) {}, guessing.FeedbackUnknown},
	} {
		t.Run(test.name, func(t *testing.T) {
			answer, guess := character("answer"), character("guess")
			test.change(&guess)
			if got := guessing.CompareField(guess, answer, test.field); got != test.want {
				t.Fatalf("feedback = %s, want %s", got, test.want)
			}
		})
	}
}

func TestCanonicalUnknownValuesCannotCreateEquivalence(t *testing.T) {
	for _, unknown := range []string{"", " ", "unknown", " UnKnOwN ", "未知", " 未知 "} {
		t.Run(unknown, func(t *testing.T) {
			left, right := character("left"), character("right")
			left.Locations, right.Locations = []string{"known", unknown}, []string{unknown, "known"}
			if _, ok := guessing.CanonicalValue(left, guessing.FieldLocations); ok {
				t.Fatalf("%q treated as known", unknown)
			}
			if _, ok := guessing.EquivalenceSignature(left); ok {
				t.Fatalf("%q produced a complete signature", unknown)
			}
			catalog := mustCatalog(t, guessing.AnswerMatchPublicFieldsV1, left, right)
			result, err := catalog.Evaluate(left.ID, right.ID, nil)
			if err != nil || result.IsCorrect {
				t.Fatalf("unknown values matched: %+v, %v", result, err)
			}
		})
	}
}

func TestCanonicalValuesAreIndependentAndPreserveKnownStrings(t *testing.T) {
	input := character("input")
	input.Species = []string{"youkai", "magician", "youkai"}
	value, ok := guessing.CanonicalValue(input, guessing.FieldSpecies)
	if !ok || !reflect.DeepEqual(value.SetValue, []string{"magician", "youkai"}) {
		t.Fatalf("canonical set = %+v, %v", value, ok)
	}
	if !reflect.DeepEqual(input.Species, []string{"youkai", "magician", "youkai"}) {
		t.Fatal("canonicalization changed input order")
	}
	value.SetValue[0] = "changed"
	if input.Species[0] != "youkai" || input.Species[1] != "magician" {
		t.Fatal("canonical value shares input storage")
	}
	input.FirstAppearance.WorkID = " work "
	value, ok = guessing.CanonicalValue(input, guessing.FieldFirstAppearance)
	if !ok || *value.StringValue != " work " {
		t.Fatal("known strings should retain whitespace")
	}
	*value.StringValue = "changed"
	if input.FirstAppearance.WorkID != " work " {
		t.Fatal("canonical string shares input storage")
	}
	if _, ok := guessing.CanonicalValue(input, guessing.FieldKey("unsupported")); ok {
		t.Fatal("unsupported field has a canonical value")
	}
}
