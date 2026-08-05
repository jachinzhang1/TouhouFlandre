-- seed：作品与角色写入
-- name: UpsertWork :exec
INSERT INTO work (
    id, title_zh, title_ja, title_en, short_name, type, release_year, mainline_index, era
) VALUES (
    @id, @title_zh, @title_ja, @title_en, @short_name, @type, @release_year, @mainline_index, @era
)
ON CONFLICT (id) DO UPDATE SET
    title_zh = EXCLUDED.title_zh,
    title_ja = EXCLUDED.title_ja,
    title_en = EXCLUDED.title_en,
    short_name = EXCLUDED.short_name,
    type = EXCLUDED.type,
    release_year = EXCLUDED.release_year,
    mainline_index = EXCLUDED.mainline_index,
    era = EXCLUDED.era,
    updated_at = now();

-- name: UpsertCharacter :exec
INSERT INTO character (
    id, avatar_url, display_name, name_sort_key, search_text, appearance_order,
    first_appearance_work_id, names, first_appearance, species, ability_display,
    ability_tags, affiliations, locations, roles, hair_colors, playable,
    enabled_as_answer, enabled_as_guess, difficulty_tier, source_refs
) VALUES (
    @id, @avatar_url, @display_name, @name_sort_key, @search_text, @appearance_order,
    @first_appearance_work_id, @names, @first_appearance, @species, @ability_display,
    @ability_tags, @affiliations, @locations, @roles, @hair_colors, @playable,
    @enabled_as_answer, @enabled_as_guess, @difficulty_tier, @source_refs
)
ON CONFLICT (id) DO UPDATE SET
    avatar_url = EXCLUDED.avatar_url,
    display_name = EXCLUDED.display_name,
    name_sort_key = EXCLUDED.name_sort_key,
    search_text = EXCLUDED.search_text,
    appearance_order = EXCLUDED.appearance_order,
    first_appearance_work_id = EXCLUDED.first_appearance_work_id,
    names = EXCLUDED.names,
    first_appearance = EXCLUDED.first_appearance,
    species = EXCLUDED.species,
    ability_display = EXCLUDED.ability_display,
    ability_tags = EXCLUDED.ability_tags,
    affiliations = EXCLUDED.affiliations,
    locations = EXCLUDED.locations,
    roles = EXCLUDED.roles,
    hair_colors = EXCLUDED.hair_colors,
    playable = EXCLUDED.playable,
    enabled_as_answer = EXCLUDED.enabled_as_answer,
    enabled_as_guess = EXCLUDED.enabled_as_guess,
    difficulty_tier = EXCLUDED.difficulty_tier,
    source_refs = EXCLUDED.source_refs,
    updated_at = now();

-- name: DeleteCharactersNotIn :exec
DELETE FROM character WHERE id <> ALL(@ids::text[]);

-- name: DeleteWorksNotIn :exec
DELETE FROM work WHERE id <> ALL(@ids::text[]);
