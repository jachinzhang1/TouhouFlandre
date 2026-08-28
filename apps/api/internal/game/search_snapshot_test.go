package game

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
)

func testSearchCharacter(id string, enabled bool) Character {
	return Character{
		ID: id, EnabledAsGuess: enabled, AvatarURL: "/characters/" + id + ".png",
		Names:           LocalizedNames{ZhHans: id, Ja: id, En: id, Aliases: []string{id}},
		FirstAppearance: FirstAppearance{WorkID: "th06", WorkTitle: "东方红魔乡", ReleaseYear: 2002},
		Species:         []string{"human"}, Affiliations: []string{"shrine"}, Locations: []string{"gensokyo"}, HairColors: []string{"black"},
	}
}

func TestCatalogSearchSourceProviderCoalescesConcurrentLoads(t *testing.T) {
	var loads atomic.Int32
	provider := NewCatalogSearchSourceProvider(func(_ context.Context, version string) ([]Character, error) {
		loads.Add(1)
		return []Character{testSearchCharacter(version, true)}, nil
	})

	const callers = 20
	var wait sync.WaitGroup
	wait.Add(callers)
	results := make(chan []Character, callers)
	for range callers {
		go func() {
			defer wait.Done()
			characters, err := provider.GetContext(context.Background(), "catalog-v1")
			if err != nil {
				t.Errorf("source load: %v", err)
				return
			}
			results <- characters
		}()
	}
	wait.Wait()
	close(results)
	if got := loads.Load(); got != 1 {
		t.Fatalf("loader calls=%d, want 1", got)
	}
	for characters := range results {
		if len(characters) != 1 || characters[0].ID != "catalog-v1" {
			t.Fatalf("unexpected source result: %+v", characters)
		}
	}
}

func TestCatalogSearchSourceProviderRetriesFailuresAndEvictsLRU(t *testing.T) {
	var loads atomic.Int32
	provider := NewCatalogSearchSourceProvider(func(_ context.Context, version string) ([]Character, error) {
		call := loads.Add(1)
		if version == "retry" && call == 1 {
			return nil, errors.New("temporary")
		}
		return []Character{testSearchCharacter(version, true)}, nil
	})
	if _, err := provider.Get("retry"); err == nil {
		t.Fatal("expected first load to fail")
	}
	if _, err := provider.Get("retry"); err != nil {
		t.Fatalf("retry failed: %v", err)
	}
	for index := 0; index < 8; index++ {
		if _, err := provider.Get(string(rune('a' + index))); err != nil {
			t.Fatalf("load %d: %v", index, err)
		}
	}
	if _, err := provider.Get("evicted"); err != nil {
		t.Fatalf("load evicted key: %v", err)
	}
	before := loads.Load()
	if _, err := provider.Get("retry"); err != nil {
		t.Fatalf("rebuild evicted key: %v", err)
	}
	if loads.Load() <= before {
		t.Fatal("expected evicted source key to rebuild")
	}
}

func TestCatalogSearchSnapshotProjectsPublicFieldsAndKeepsSourceUsable(t *testing.T) {
	var loads atomic.Int32
	source := NewCatalogSearchSourceProvider(func(_ context.Context, _ string) ([]Character, error) {
		loads.Add(1)
		return []Character{testSearchCharacter("public", true), testSearchCharacter("private", false)}, nil
	})
	provider := NewCatalogSearchSnapshotProvider(source, func(string, int, []Character) (CatalogSearchSnapshot, error) {
		return CatalogSearchSnapshot{}, errors.New("projection failed")
	})
	if _, err := provider.Get(context.Background(), "catalog-v1", SearchIndexSchemaVersion); err == nil {
		t.Fatal("expected projection failure")
	}
	if _, err := source.Get("catalog-v1"); err != nil {
		t.Fatalf("source must remain usable after projection failure: %v", err)
	}
	if loads.Load() != 1 {
		t.Fatalf("source should remain cached, loads=%d", loads.Load())
	}

	snapshot, err := BuildCatalogSearchSnapshot("catalog-v1", SearchIndexSchemaVersion, []Character{testSearchCharacter("public", true), testSearchCharacter("private", false)})
	if err != nil {
		t.Fatalf("build snapshot: %v", err)
	}
	if len(snapshot.Index.Entries) != 1 || snapshot.Index.Entries[0].ID != "public" {
		t.Fatalf("unexpected public projection: %+v", snapshot.Index.Entries)
	}
	if len(snapshot.Index.Entries[0].SearchTerms) == 0 || snapshot.ETag == "" || len(snapshot.Payload) == 0 {
		t.Fatalf("snapshot missing derived wire fields: %+v", snapshot)
	}
}

func TestCatalogSearchSnapshotRejectsUnsupportedSchemaBeforeLoading(t *testing.T) {
	var loads atomic.Int32
	source := NewCatalogSearchSourceProvider(func(context.Context, string) ([]Character, error) {
		loads.Add(1)
		return []Character{testSearchCharacter("public", true)}, nil
	})
	provider := NewCatalogSearchSnapshotProvider(source, nil)
	if _, err := provider.Get(context.Background(), "catalog-v1", 2); !errors.Is(err, ErrUnsupportedSearchIndexSchema) {
		t.Fatalf("error=%v, want unsupported schema", err)
	}
	if loads.Load() != 0 {
		t.Fatalf("unsupported schema must not load source, loads=%d", loads.Load())
	}
}
