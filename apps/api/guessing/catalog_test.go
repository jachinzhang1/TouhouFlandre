package guessing_test

import (
	"errors"
	"reflect"
	"testing"

	"github.com/TouhouFlandre/touhouflandre/apps/api/guessing"
)

func character(id string) guessing.Character {
	return guessing.Character{
		ID: id, EnabledAsGuess: true,
		FirstAppearance: guessing.FirstAppearance{WorkID: "work", WorkType: "game", ReleaseYear: 2000},
		Species:         []string{"magician", "youkai"}, Affiliations: []string{"group"},
		Locations: []string{"place"}, HairColors: []string{"red", "blue"},
	}
}

func mustCatalog(t *testing.T, policy guessing.AnswerMatchPolicy, characters ...guessing.Character) *guessing.Catalog {
	t.Helper()
	catalog, err := guessing.NewCatalog(policy, characters)
	if err != nil {
		t.Fatal(err)
	}
	return catalog
}

func TestAnswerPolicyIsIndependentOfFeedbackSelection(t *testing.T) {
	answer := character("answer")
	equivalent := character("equivalent")
	equivalent.Species = []string{"youkai", "magician", "youkai"}
	equivalent.HairColors = []string{"blue", "red", "blue"}
	different := character("different")
	different.Locations = []string{"elsewhere"}
	for _, test := range []struct {
		name   string
		policy guessing.AnswerMatchPolicy
		guess  string
		kind   guessing.MatchKind
	}{
		{"strict identity", guessing.AnswerMatchStrict, answer.ID, guessing.MatchExact},
		{"strict rejects equivalent", guessing.AnswerMatchStrict, equivalent.ID, guessing.MatchNone},
		{"public identity", guessing.AnswerMatchPublicFieldsV1, answer.ID, guessing.MatchExact},
		{"public equivalent", guessing.AnswerMatchPublicFieldsV1, equivalent.ID, guessing.MatchEquivalent},
		{"public different hidden field", guessing.AnswerMatchPublicFieldsV1, different.ID, guessing.MatchNone},
	} {
		t.Run(test.name, func(t *testing.T) {
			catalog := mustCatalog(t, test.policy, answer, equivalent, different)
			for _, fields := range [][]guessing.FieldRule{
				nil,
				{},
				{{Key: guessing.FieldSpecies, CompareStrategy: "multiSet"}},
			} {
				result, err := catalog.Evaluate(answer.ID, test.guess, fields)
				if err != nil {
					t.Fatal(err)
				}
				if result.MatchKind != test.kind || result.IsCorrect != (test.kind != guessing.MatchNone) {
					t.Fatalf("fields %v: result = %+v, want kind %s", fields, result, test.kind)
				}
				wantFields := fields
				if fields == nil {
					wantFields = guessing.DefaultFields()
				}
				if len(result.Feedback) != len(wantFields) {
					t.Fatalf("feedback count = %d, want %d", len(result.Feedback), len(wantFields))
				}
				for index, field := range wantFields {
					if result.Feedback[index].Field != field.Key || result.Feedback[index].Status != guessing.FeedbackExact && field.Key != guessing.FieldLocations {
						t.Fatalf("feedback[%d] = %+v", index, result.Feedback[index])
					}
				}
			}
		})
	}
}

func TestCatalogGroupsUnknownDisabledAndDistinctIDs(t *testing.T) {
	a, b, c := character("a"), character("b"), character("c")
	c.Locations = []string{"elsewhere"}
	unknownA, unknownB := character("unknown-a"), character("unknown-b")
	unknownA.Locations, unknownB.Locations = nil, nil
	disabled := character("disabled")
	disabled.EnabledAsGuess = false
	catalog := mustCatalog(t, guessing.AnswerMatchPublicFieldsV1, b, unknownA, c, disabled, a, unknownB)
	if catalog.GroupKey(a.ID) != "equivalent:a" || catalog.GroupKey(b.ID) != "equivalent:a" {
		t.Fatalf("equivalent group keys = %q, %q", catalog.GroupKey(a.ID), catalog.GroupKey(b.ID))
	}
	for _, id := range []string{c.ID, unknownA.ID, unknownB.ID, disabled.ID, "absent"} {
		if catalog.GroupKey(id) != id {
			t.Fatalf("GroupKey(%q) = %q, want singleton", id, catalog.GroupKey(id))
		}
	}
	got := catalog.DistinctIDsByGroup([]string{b.ID, c.ID, a.ID, b.ID, "absent", "absent", unknownA.ID, unknownB.ID})
	want := []string{b.ID, c.ID, "absent", unknownA.ID, unknownB.ID}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("distinct IDs = %v, want %v", got, want)
	}
	for _, id := range []string{unknownA.ID, unknownB.ID} {
		result, err := catalog.Evaluate(id, id, nil)
		if err != nil || result.MatchKind != guessing.MatchExact {
			t.Fatalf("unknown character identity result = %+v, %v", result, err)
		}
	}
	match, err := catalog.Match(unknownA.ID, unknownB.ID)
	if err != nil || match.Correct {
		t.Fatalf("two unknown values must not establish equivalence: %+v, %v", match, err)
	}
	strict := mustCatalog(t, guessing.AnswerMatchStrict, a, b)
	if got := strict.DistinctIDsByGroup([]string{a.ID, b.ID}); !reflect.DeepEqual(got, []string{a.ID, b.ID}) {
		t.Fatalf("strict groups collapsed separate identities: %v", got)
	}
}

func TestCatalogRejectsInvalidInputAndGuesses(t *testing.T) {
	for _, input := range []struct {
		name       string
		policy     guessing.AnswerMatchPolicy
		characters []guessing.Character
	}{
		{"unsupported policy", "other", nil},
		{"empty ID", guessing.AnswerMatchStrict, []guessing.Character{character("")}},
		{"duplicate ID", guessing.AnswerMatchStrict, []guessing.Character{character("same"), character("same")}},
	} {
		t.Run(input.name, func(t *testing.T) {
			if _, err := guessing.NewCatalog(input.policy, input.characters); err == nil {
				t.Fatal("expected invalid catalog error")
			}
		})
	}
	for _, name := range []string{"", "other", "STRICT"} {
		if _, err := guessing.ParseAnswerMatchPolicy(name); err == nil {
			t.Fatalf("expected invalid policy error for %q", name)
		}
	}
	for _, policy := range []guessing.AnswerMatchPolicy{guessing.AnswerMatchStrict, guessing.AnswerMatchPublicFieldsV1} {
		if got, err := guessing.ParseAnswerMatchPolicy(string(policy)); err != nil || got != policy {
			t.Fatalf("parse policy = %q, %v", got, err)
		}
	}
	valid, disabled := character("valid"), character("disabled")
	disabled.EnabledAsGuess = false
	catalog := mustCatalog(t, guessing.AnswerMatchPublicFieldsV1, valid, disabled)
	for _, test := range []struct {
		answer string
		guess  string
		want   error
	}{
		{"absent", "absent", guessing.ErrGuessCharacterMissing},
		{"absent", disabled.ID, guessing.ErrGuessCharacterDisabled},
		{"absent", valid.ID, guessing.ErrAnswerCharacterMissing},
		{valid.ID, "absent", guessing.ErrGuessCharacterMissing},
		{valid.ID, disabled.ID, guessing.ErrGuessCharacterDisabled},
	} {
		if _, err := catalog.Evaluate(test.answer, test.guess, nil); !errors.Is(err, test.want) {
			t.Errorf("Evaluate(%q, %q) error = %v, want %v", test.answer, test.guess, err, test.want)
		}
	}
	if err := catalog.ValidateGuess(valid.ID); err != nil {
		t.Fatalf("valid guess error: %v", err)
	}
	if _, err := catalog.Evaluate(disabled.ID, valid.ID, nil); err != nil {
		t.Fatalf("answer selection should be caller-owned: %v", err)
	}
}

func TestCatalogDeepCopiesItsInput(t *testing.T) {
	characters := []guessing.Character{character("answer"), character("guess")}
	catalog := mustCatalog(t, guessing.AnswerMatchPublicFieldsV1, characters...)
	characters[1].ID = "changed"
	characters[1].EnabledAsGuess = false
	characters[1].FirstAppearance.WorkID = "other"
	characters[1].FirstAppearance.ReleaseYear = 2020
	characters[1].Species[0] = "other"
	characters[1].Affiliations[0] = "other"
	characters[1].Locations[0] = "other"
	characters[1].HairColors[0] = "other"
	result, err := catalog.Evaluate("answer", "guess", nil)
	if err != nil || result.MatchKind != guessing.MatchEquivalent || !result.IsCorrect {
		t.Fatalf("input mutation changed matching: %+v, %v", result, err)
	}
	for _, feedback := range result.Feedback {
		if feedback.Status != guessing.FeedbackExact {
			t.Fatalf("input mutation changed feedback: %+v", feedback)
		}
	}
	result.Feedback[0].Status = guessing.FeedbackMiss
	result.Feedback[1].Field = guessing.FieldSpecies
	again, err := catalog.Evaluate("answer", "guess", nil)
	if err != nil || again.Feedback[0].Status != guessing.FeedbackExact || again.Feedback[1].Field != guessing.FieldReleaseYear {
		t.Fatalf("result mutation affected subsequent evaluation: %+v, %v", again, err)
	}
}

func TestSelectedFieldOrderAndRules(t *testing.T) {
	answer, guess := character("answer"), character("guess")
	guess.FirstAppearance.ReleaseYear--
	catalog := mustCatalog(t, guessing.AnswerMatchStrict, answer, guess)
	fields := []guessing.FieldRule{
		{Key: guessing.FieldHairColors},
		{Key: guessing.FieldReleaseYear, CompareStrategy: "numberExact"},
		{Key: guessing.FieldReleaseYear, CompareStrategy: "numberDirection"},
		{Key: guessing.FieldKey("unsupported")},
	}
	result, err := catalog.Evaluate(answer.ID, guess.ID, fields)
	if err != nil {
		t.Fatal(err)
	}
	want := []guessing.FieldFeedback{
		{Field: guessing.FieldHairColors, Status: guessing.FeedbackExact},
		{Field: guessing.FieldReleaseYear, Status: guessing.FeedbackMiss},
		{Field: guessing.FieldReleaseYear, Status: guessing.FeedbackHigher},
		{Field: guessing.FieldKey("unsupported"), Status: guessing.FeedbackUnknown},
	}
	if !reflect.DeepEqual(result.Feedback, want) {
		t.Fatalf("feedback = %+v, want %+v", result.Feedback, want)
	}
	defaults := guessing.DefaultFields()
	defaults[0] = guessing.FieldRule{Key: "unsupported"}
	if guessing.DefaultFields()[0].Key != guessing.FieldFirstAppearance {
		t.Fatal("default field rules were mutable through a returned slice")
	}
}
