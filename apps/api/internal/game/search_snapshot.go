package game

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"
)

const (
	SearchIndexSchemaVersion = 1
	searchProviderCacheSize  = 8
)

var (
	ErrUnsupportedSearchIndexSchema = errors.New("unsupported search index schema")
	ErrInvalidSearchIndex           = errors.New("invalid search index")
)

// CatalogSearchSourceProvider is the parsed, server-owned source for search.
// It intentionally contains no wire-format or index-schema concerns.
type CatalogSearchSourceProvider struct {
	cache   *sharedLRU[string, []Character]
	loader  func(ctx context.Context, version string) ([]Character, error)
	metrics *SearchMetrics
}

// NewCatalogSearchSourceProvider creates a source provider. The loader must
// read an immutable CatalogSnapshot for the requested version.
func NewCatalogSearchSourceProvider(loader func(context.Context, string) ([]Character, error)) *CatalogSearchSourceProvider {
	if loader == nil {
		loader = func(context.Context, string) ([]Character, error) {
			return nil, errors.New("nil catalog search source loader")
		}
	}
	return &CatalogSearchSourceProvider{
		cache:   newSharedLRU[string, []Character](searchProviderCacheSize),
		loader:  loader,
		metrics: DefaultSearchMetrics,
	}
}

// Get returns a defensive copy so callers cannot mutate cached source data.
func (p *CatalogSearchSourceProvider) Get(version string) ([]Character, error) {
	return p.GetContext(context.Background(), version)
}

// GetContext is the context-aware source lookup used by HTTP handlers.
func (p *CatalogSearchSourceProvider) GetContext(ctx context.Context, version string) ([]Character, error) {
	if strings.TrimSpace(version) == "" {
		return nil, fmt.Errorf("%w: empty catalog version", ErrInvalidSearchIndex)
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if p.cache.contains(version) {
		p.metrics.IncProviderOutcome("source", "hit")
	} else {
		p.metrics.IncProviderOutcome("source", "miss")
	}
	characters, err := p.cache.get(ctx, version, func(loadCtx context.Context) ([]Character, error) {
		loaded, err := p.loader(loadCtx, version)
		if err != nil {
			p.metrics.IncProviderOutcome("source", "load_error")
			slog.Debug("catalog search source load failed", "outcome", "load_error")
			return nil, err
		}
		p.metrics.IncProviderOutcome("source", "load_success")
		slog.Debug("catalog search source loaded", "outcome", "load_success")
		return cloneCharacters(loaded), err
	})
	if err != nil {
		return nil, err
	}
	return cloneCharacters(characters), nil
}

type CatalogSearchIndexEntry struct {
	Affiliations    []string `json:"affiliations"`
	AppearanceOrder int      `json:"appearanceOrder"`
	AvatarURL       string   `json:"avatarUrl"`
	FirstAppearance struct {
		ReleaseYear int    `json:"releaseYear"`
		WorkTitle   string `json:"workTitle"`
	} `json:"firstAppearance"`
	HairColors  []string `json:"hairColors"`
	ID          string   `json:"id"`
	Initials    string   `json:"initials"`
	Locations   []string `json:"locations"`
	Name        string   `json:"name"`
	NameSortKey string   `json:"nameSortKey"`
	SearchTerms []string `json:"searchTerms"`
	Species     []string `json:"species"`
	Subtitle    string   `json:"subtitle"`
	WorkID      string   `json:"workId"`
}

type CatalogSearchIndex struct {
	CatalogVersion     string                    `json:"catalogVersion"`
	Entries            []CatalogSearchIndexEntry `json:"entries"`
	IndexSchemaVersion int                       `json:"indexSchemaVersion"`
}

// CatalogSearchSnapshot contains the validated index and its immutable wire
// representation. ETag is a strong hash of Payload.
type CatalogSearchSnapshot struct {
	Index   CatalogSearchIndex
	Payload []byte
	ETag    string
}

type CatalogSearchSnapshotBuilder func(version string, schemaVersion int, characters []Character) (CatalogSearchSnapshot, error)

type searchIndexKey struct {
	CatalogVersion string
	SchemaVersion  int
}

type CatalogSearchSnapshotProvider struct {
	source  *CatalogSearchSourceProvider
	cache   *sharedLRU[searchIndexKey, CatalogSearchSnapshot]
	builder CatalogSearchSnapshotBuilder
	metrics *SearchMetrics
}

func NewCatalogSearchSnapshotProvider(source *CatalogSearchSourceProvider, builder CatalogSearchSnapshotBuilder) *CatalogSearchSnapshotProvider {
	if builder == nil {
		builder = BuildCatalogSearchSnapshot
	}
	return &CatalogSearchSnapshotProvider{
		source:  source,
		cache:   newSharedLRU[searchIndexKey, CatalogSearchSnapshot](searchProviderCacheSize),
		builder: builder,
		metrics: DefaultSearchMetrics,
	}
}

func (p *CatalogSearchSnapshotProvider) Get(ctx context.Context, version string, schemaVersion int) (CatalogSearchSnapshot, error) {
	if strings.TrimSpace(version) == "" {
		return CatalogSearchSnapshot{}, fmt.Errorf("%w: empty catalog version", ErrInvalidSearchIndex)
	}
	if schemaVersion != SearchIndexSchemaVersion {
		return CatalogSearchSnapshot{}, fmt.Errorf("%w: %d", ErrUnsupportedSearchIndexSchema, schemaVersion)
	}
	key := searchIndexKey{CatalogVersion: version, SchemaVersion: schemaVersion}
	if p.cache.contains(key) {
		p.metrics.IncProviderOutcome("snapshot", "hit")
	} else {
		p.metrics.IncProviderOutcome("snapshot", "miss")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	snapshot, err := p.cache.get(ctx, key, func(loadCtx context.Context) (CatalogSearchSnapshot, error) {
		if p.source == nil {
			return CatalogSearchSnapshot{}, errors.New("nil catalog search source provider")
		}
		characters, err := p.source.GetContext(loadCtx, version)
		if err != nil {
			p.metrics.IncProviderOutcome("snapshot", "load_error")
			slog.Debug("catalog search snapshot source failed", "outcome", "load_error")
			return CatalogSearchSnapshot{}, err
		}
		started := time.Now()
		snapshot, err := p.builder(version, schemaVersion, characters)
		p.metrics.ObserveIndexBuild(time.Since(started))
		if err != nil {
			p.metrics.IncProviderOutcome("snapshot", "build_error")
			slog.Debug("catalog search snapshot build failed", "outcome", "build_error")
			return CatalogSearchSnapshot{}, err
		}
		p.metrics.IncProviderOutcome("snapshot", "build_success")
		slog.Debug("catalog search snapshot built", "outcome", "build_success")
		return snapshot, nil
	})
	if err != nil {
		return CatalogSearchSnapshot{}, err
	}
	return cloneCatalogSearchSnapshot(snapshot), nil
}

func BuildCatalogSearchSnapshot(version string, schemaVersion int, characters []Character) (CatalogSearchSnapshot, error) {
	if strings.TrimSpace(version) == "" {
		return CatalogSearchSnapshot{}, fmt.Errorf("%w: empty catalog version", ErrInvalidSearchIndex)
	}
	if schemaVersion != SearchIndexSchemaVersion {
		return CatalogSearchSnapshot{}, fmt.Errorf("%w: %d", ErrUnsupportedSearchIndexSchema, schemaVersion)
	}
	entries := make([]CatalogSearchIndexEntry, 0, len(characters))
	for _, character := range characters {
		if !character.EnabledAsGuess {
			continue
		}
		terms := CharacterSearchTerms(character)
		nameSortKey := CharacterNameSortKey(character)
		if character.ID == "" || len(terms) == 0 || nameSortKey == "" {
			return CatalogSearchSnapshot{}, fmt.Errorf("%w: character %q", ErrInvalidSearchIndex, character.ID)
		}
		initials := []rune(character.Names.ZhHans)
		if len(initials) > 2 {
			initials = initials[:2]
		}
		entry := CatalogSearchIndexEntry{
			ID:              character.ID,
			Name:            character.Names.ZhHans,
			Subtitle:        character.Names.En + " · " + character.FirstAppearance.WorkTitle,
			Initials:        string(initials),
			AvatarURL:       character.AvatarURL,
			AppearanceOrder: character.AppearanceOrder,
			WorkID:          character.FirstAppearance.WorkID,
			Species:         append([]string(nil), character.Species...),
			Locations:       append([]string(nil), character.Locations...),
			Affiliations:    append([]string(nil), character.Affiliations...),
			HairColors:      append([]string(nil), character.HairColors...),
			SearchTerms:     append([]string(nil), terms...),
			NameSortKey:     nameSortKey,
		}
		entry.FirstAppearance.WorkTitle = character.FirstAppearance.WorkTitle
		entry.FirstAppearance.ReleaseYear = character.FirstAppearance.ReleaseYear
		entries = append(entries, entry)
	}
	index := CatalogSearchIndex{CatalogVersion: version, IndexSchemaVersion: schemaVersion, Entries: entries}
	payload, err := json.Marshal(index)
	if err != nil {
		return CatalogSearchSnapshot{}, fmt.Errorf("%w: marshal: %v", ErrInvalidSearchIndex, err)
	}
	digest := sha256.Sum256(payload)
	return CatalogSearchSnapshot{Index: index, Payload: payload, ETag: `"` + hex.EncodeToString(digest[:]) + `"`}, nil
}

func cloneCatalogSearchSnapshot(snapshot CatalogSearchSnapshot) CatalogSearchSnapshot {
	clone := snapshot
	clone.Payload = append([]byte(nil), snapshot.Payload...)
	clone.Index.Entries = make([]CatalogSearchIndexEntry, len(snapshot.Index.Entries))
	for index, entry := range snapshot.Index.Entries {
		clone.Index.Entries[index] = entry
		clone.Index.Entries[index].Species = append([]string(nil), entry.Species...)
		clone.Index.Entries[index].Locations = append([]string(nil), entry.Locations...)
		clone.Index.Entries[index].Affiliations = append([]string(nil), entry.Affiliations...)
		clone.Index.Entries[index].HairColors = append([]string(nil), entry.HairColors...)
		clone.Index.Entries[index].SearchTerms = append([]string(nil), entry.SearchTerms...)
	}
	return clone
}

func cloneCharacters(characters []Character) []Character {
	clone := make([]Character, len(characters))
	for index, character := range characters {
		clone[index] = character
		clone[index].Species = append([]string(nil), character.Species...)
		clone[index].AbilityTags = append([]string(nil), character.AbilityTags...)
		clone[index].Affiliations = append([]string(nil), character.Affiliations...)
		clone[index].Locations = append([]string(nil), character.Locations...)
		clone[index].Roles = append([]string(nil), character.Roles...)
		clone[index].HairColors = append([]string(nil), character.HairColors...)
		clone[index].SourceRefs = append([]string(nil), character.SourceRefs...)
		clone[index].Names.Aliases = append([]string(nil), character.Names.Aliases...)
		clone[index].FirstAppearance.WorkPinyinInitials = append([]string(nil), character.FirstAppearance.WorkPinyinInitials...)
		if character.Names.ZhHant != nil {
			value := *character.Names.ZhHant
			clone[index].Names.ZhHant = &value
		}
		if character.Names.Romaji != nil {
			value := *character.Names.Romaji
			clone[index].Names.Romaji = &value
		}
		if character.FirstAppearance.MainlineIndex != nil {
			value := *character.FirstAppearance.MainlineIndex
			clone[index].FirstAppearance.MainlineIndex = &value
		}
		if character.FirstAppearance.Era != nil {
			value := *character.FirstAppearance.Era
			clone[index].FirstAppearance.Era = &value
		}
	}
	return clone
}
