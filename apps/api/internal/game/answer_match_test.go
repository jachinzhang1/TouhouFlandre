package game_test

import (
	"context"
	"errors"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
)

func equivalentFixture(id string) game.Character {
	return game.Character{
		ID: id, Names: game.LocalizedNames{ZhHans: id},
		FirstAppearance: game.FirstAppearance{WorkID: "work", WorkTitle: "Work", WorkType: "game", ReleaseYear: 2000},
		Species:         []string{"youkai", "magician"}, Affiliations: []string{"group"},
		Locations: []string{"place"}, HairColors: []string{"red", "blue"},
		EnabledAsAnswer: true, EnabledAsGuess: true,
	}
}

func TestCharacterFieldRegistryV1(t *testing.T) {
	want := []game.GuessFieldKey{
		game.FieldFirstAppearance, game.FieldReleaseYear, game.FieldSpecies,
		game.FieldAffiliations, game.FieldLocations, game.FieldHairColors,
	}
	definitions := game.CharacterFields.Definitions()
	got := make([]game.GuessFieldKey, 0, len(definitions))
	for _, definition := range definitions {
		if !definition.Equivalence || !definition.Configurable {
			t.Fatalf("public field %s is not configurable and equivalent", definition.Key)
		}
		got = append(got, definition.Key)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("public_fields_v1 keys = %v, want %v", got, want)
	}
}

func TestCatalogRuntimeEquivalenceFixture(t *testing.T) {
	a := equivalentFixture("a")
	b := equivalentFixture("b")
	b.Species = []string{"magician", "youkai"}
	b.HairColors = []string{"blue", "red"}
	c := equivalentFixture("c")
	c.Locations = []string{"elsewhere"}
	d := equivalentFixture("d")
	unknownA := equivalentFixture("unknown-a")
	unknownA.Locations = nil
	unknownB := equivalentFixture("unknown-b")
	unknownB.Locations = nil
	unknownLiteralA := equivalentFixture("unknown-literal-a")
	unknownLiteralA.Locations = []string{"unknown"}
	unknownLiteralB := equivalentFixture("unknown-literal-b")
	unknownLiteralB.Locations = []string{"unknown"}
	disabled := equivalentFixture("disabled")
	disabled.EnabledAsGuess = false

	runtime, err := game.BuildCatalogRuntime("fixture", game.AnswerMatchPublicFieldsV1, []game.Character{
		a, b, c, d, unknownA, unknownB, unknownLiteralA, unknownLiteralB, disabled,
	})
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GroupKey("a") != runtime.GroupKey("b") || runtime.GroupKey("a") != runtime.GroupKey("d") {
		t.Fatal("set ordering should not split the three-member equivalent group")
	}
	if runtime.GroupKey("a") == runtime.GroupKey("c") {
		t.Fatal("a public-field difference must split groups")
	}
	if runtime.GroupKey("unknown-a") == runtime.GroupKey("unknown-b") {
		t.Fatal("characters with unknown public fields must remain singletons")
	}
	if runtime.GroupKey("unknown-literal-a") == runtime.GroupKey("unknown-literal-b") {
		t.Fatal("literal unknown public fields must remain singletons")
	}
	if runtime.GroupKey("a") == runtime.GroupKey("disabled") {
		t.Fatal("a non-guessable character must not enter an equivalence group")
	}
}

func TestGuessEvaluatorUsesFullPublicSignature(t *testing.T) {
	answer := equivalentFixture("answer")
	equivalent := equivalentFixture("equivalent")
	different := equivalentFixture("different")
	different.Locations = []string{"different"}
	disabled := equivalentFixture("disabled")
	disabled.EnabledAsGuess = false
	provider := game.NewCatalogRuntimeProvider(func(context.Context, string) ([]game.Character, error) {
		return []game.Character{answer, equivalent, different, disabled}, nil
	})
	evaluator := game.NewGuessEvaluator(provider)
	fields := []game.GuessField{{
		Key: game.FieldSpecies, Label: "species", Type: "multi_enum", Visible: true, CompareStrategy: "multiSet",
	}}

	result, err := evaluator.Evaluate(context.Background(), "fixture", game.AnswerMatchPublicFieldsV1, answer.ID, equivalent.ID, fields)
	if err != nil {
		t.Fatal(err)
	}
	if !result.IsCorrect || result.MatchKind != game.MatchEquivalent {
		t.Fatalf("equivalent result = %+v", result)
	}
	result, err = evaluator.Evaluate(context.Background(), "fixture", game.AnswerMatchPublicFieldsV1, answer.ID, different.ID, fields)
	if err != nil {
		t.Fatal(err)
	}
	if result.IsCorrect || result.MatchKind != game.MatchNone {
		t.Fatal("enabling only one matching field must not expand equivalence")
	}
	if _, err := evaluator.Evaluate(context.Background(), "fixture", game.AnswerMatchPublicFieldsV1, answer.ID, disabled.ID, fields); err != game.ErrGuessCharacterDisabled {
		t.Fatalf("disabled guess error = %v", err)
	}
	result, err = evaluator.Evaluate(context.Background(), "fixture", game.AnswerMatchStrict, answer.ID, equivalent.ID, fields)
	if err != nil {
		t.Fatal(err)
	}
	if result.IsCorrect || result.MatchKind != game.MatchNone {
		t.Fatal("strict policy must require identity")
	}
}

func TestCatalogRuntimeProviderMergesConcurrentLoads(t *testing.T) {
	var loads atomic.Int32
	loader := func(context.Context, string) ([]game.Character, error) {
		loads.Add(1)
		time.Sleep(20 * time.Millisecond)
		return []game.Character{equivalentFixture("answer")}, nil
	}
	var defaultLoads atomic.Int32
	provider := game.NewCatalogRuntimeProvider(func(context.Context, string) ([]game.Character, error) {
		defaultLoads.Add(1)
		return nil, errors.New("default loader used")
	})
	var wait sync.WaitGroup
	for range 24 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			if _, err := provider.GetWithLoader(context.Background(), "same", game.AnswerMatchPublicFieldsV1, loader); err != nil {
				t.Errorf("GetWithLoader: %v", err)
			}
		}()
	}
	wait.Wait()
	if got := loads.Load(); got != 1 {
		t.Fatalf("loader called %d times, want 1", got)
	}
	if got := defaultLoads.Load(); got != 0 {
		t.Fatalf("default loader called %d times, want 0", got)
	}
}

func TestCatalogRuntimeProviderUsesCustomLoaderAndCachesResult(t *testing.T) {
	var defaultLoads atomic.Int32
	provider := game.NewCatalogRuntimeProvider(func(context.Context, string) ([]game.Character, error) {
		defaultLoads.Add(1)
		return []game.Character{equivalentFixture("default")}, nil
	})
	var customLoads atomic.Int32
	customLoader := func(_ context.Context, version string) ([]game.Character, error) {
		customLoads.Add(1)
		if version != "custom-version" {
			t.Fatalf("loader version = %q", version)
		}
		return []game.Character{equivalentFixture("custom")}, nil
	}

	runtime, err := provider.GetWithLoader(context.Background(), "custom-version", game.AnswerMatchPublicFieldsV1, customLoader)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := runtime.ByID["custom"]; !ok {
		t.Fatalf("custom runtime characters = %+v", runtime.Characters)
	}
	cached, err := provider.Get(context.Background(), "custom-version", game.AnswerMatchPublicFieldsV1)
	if err != nil {
		t.Fatal(err)
	}
	if cached != runtime {
		t.Fatal("default Get did not reuse the custom-loaded runtime")
	}
	if got := customLoads.Load(); got != 1 {
		t.Fatalf("custom loader called %d times, want 1", got)
	}
	if got := defaultLoads.Load(); got != 0 {
		t.Fatalf("default loader called %d times, want 0", got)
	}
}

func TestCatalogRuntimeProviderRetriesAfterCustomLoaderFailure(t *testing.T) {
	wantErr := errors.New("load failed")
	provider := game.NewCatalogRuntimeProvider(func(context.Context, string) ([]game.Character, error) {
		t.Fatal("default loader must not be used")
		return nil, nil
	})
	var loads atomic.Int32
	loader := func(context.Context, string) ([]game.Character, error) {
		if loads.Add(1) == 1 {
			return nil, wantErr
		}
		return []game.Character{equivalentFixture("answer")}, nil
	}

	if _, err := provider.GetWithLoader(context.Background(), "retry", game.AnswerMatchPublicFieldsV1, loader); !errors.Is(err, wantErr) {
		t.Fatalf("first load error = %v, want %v", err, wantErr)
	}
	runtime, err := provider.GetWithLoader(context.Background(), "retry", game.AnswerMatchPublicFieldsV1, loader)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := runtime.ByID["answer"]; !ok {
		t.Fatalf("retry runtime characters = %+v", runtime.Characters)
	}
	if got := loads.Load(); got != 2 {
		t.Fatalf("loader called %d times, want 2", got)
	}
}

func TestCatalogRuntimeProviderRejectsNilCustomLoader(t *testing.T) {
	provider := game.NewCatalogRuntimeProvider(func(context.Context, string) ([]game.Character, error) {
		return []game.Character{equivalentFixture("default")}, nil
	})
	if _, err := provider.GetWithLoader(context.Background(), "fixture", game.AnswerMatchPublicFieldsV1, nil); !errors.Is(err, game.ErrCatalogRuntimeLoaderMissing) {
		t.Fatalf("nil loader error = %v", err)
	}
}

func TestCharacterFieldRegistryFeedbackStrategies(t *testing.T) {
	answer := equivalentFixture("answer")
	guess := equivalentFixture("guess")

	yearExact, ok := game.CharacterFields.GuessField(game.FieldReleaseYear, game.FieldModeExactOnly)
	if !ok {
		t.Fatal("release year exact-only field is unavailable")
	}
	guess.FirstAppearance.ReleaseYear--
	if status := game.CharacterFields.CompareFeedback(guess, answer, yearExact); status != game.FeedbackMiss {
		t.Fatalf("numberExact status = %s, want miss", status)
	}
	yearDirectional, _ := game.CharacterFields.GuessField(game.FieldReleaseYear, game.FieldModeDirectional)
	if status := game.CharacterFields.CompareFeedback(guess, answer, yearDirectional); status != game.FeedbackHigher {
		t.Fatalf("numberDirection status = %s, want higher", status)
	}

	firstAppearance, _ := game.CharacterFields.GuessField(game.FieldFirstAppearance, game.FieldModeDefault)
	guess.FirstAppearance.WorkID = "other"
	if status := game.CharacterFields.CompareFeedback(guess, answer, firstAppearance); status != game.FeedbackPartial {
		t.Fatalf("first appearance same-type status = %s, want partial", status)
	}
	guess.FirstAppearance.WorkID = "unknown"
	if status := game.CharacterFields.CompareFeedback(guess, answer, firstAppearance); status != game.FeedbackUnknown {
		t.Fatalf("first appearance unknown status = %s, want unknown", status)
	}

	species, _ := game.CharacterFields.GuessField(game.FieldSpecies, game.FieldModeDefault)
	guess.Species = []string{"magician", "other"}
	if status := game.CharacterFields.CompareFeedback(guess, answer, species); status != game.FeedbackPartial {
		t.Fatalf("multiSet overlap status = %s, want partial", status)
	}
	guess.Species = []string{"unknown"}
	if status := game.CharacterFields.CompareFeedback(guess, answer, species); status != game.FeedbackUnknown {
		t.Fatalf("multiSet unknown status = %s, want unknown", status)
	}
}
