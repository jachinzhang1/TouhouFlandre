PRAGMA foreign_keys=OFF;

CREATE TABLE "CatalogSnapshot" (
    "version" TEXT NOT NULL PRIMARY KEY,
    "charactersJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "CatalogState" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'current',
    "currentVersion" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CatalogState_currentVersion_fkey" FOREIGN KEY ("currentVersion") REFERENCES "CatalogSnapshot" ("version") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CatalogState_currentVersion_key" ON "CatalogState"("currentVersion");

CREATE TABLE "DailyPuzzle" (
    "dateKey" TEXT NOT NULL PRIMARY KEY,
    "catalogVersion" TEXT NOT NULL,
    "answerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyPuzzle_catalogVersion_fkey" FOREIGN KEY ("catalogVersion") REFERENCES "CatalogSnapshot" ("version") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "DailyPuzzle_catalogVersion_idx" ON "DailyPuzzle"("catalogVersion");

INSERT INTO "CatalogSnapshot" ("version", "charactersJson") VALUES ('legacy', '[]');
INSERT INTO "CatalogState" ("id", "currentVersion", "updatedAt") VALUES ('current', 'legacy', CURRENT_TIMESTAMP);

CREATE TABLE "new_Character" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "avatarUrl" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "nameSortKey" TEXT NOT NULL,
    "searchText" TEXT NOT NULL,
    "appearanceOrder" INTEGER NOT NULL,
    "firstAppearanceWorkId" TEXT NOT NULL,
    "namesJson" TEXT NOT NULL,
    "firstAppearanceJson" TEXT NOT NULL,
    "speciesJson" TEXT NOT NULL,
    "abilityDisplay" TEXT NOT NULL,
    "abilityTagsJson" TEXT NOT NULL,
    "affiliationsJson" TEXT NOT NULL,
    "locationsJson" TEXT NOT NULL,
    "rolesJson" TEXT NOT NULL,
    "hairColorsJson" TEXT NOT NULL,
    "playable" BOOLEAN NOT NULL,
    "enabledAsAnswer" BOOLEAN NOT NULL,
    "enabledAsGuess" BOOLEAN NOT NULL,
    "difficultyTier" TEXT NOT NULL,
    "sourceRefsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Character_firstAppearanceWorkId_fkey" FOREIGN KEY ("firstAppearanceWorkId") REFERENCES "Work" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_Character" (
    "id", "avatarUrl", "displayName", "nameSortKey", "searchText", "appearanceOrder", "firstAppearanceWorkId",
    "namesJson", "firstAppearanceJson", "speciesJson", "abilityDisplay",
    "abilityTagsJson", "affiliationsJson", "locationsJson", "rolesJson",
    "hairColorsJson", "playable", "enabledAsAnswer", "enabledAsGuess",
    "difficultyTier", "sourceRefsJson", "createdAt", "updatedAt"
)
SELECT
    "id", '',
    json_extract("namesJson", '$.zhHans'),
    lower(json_extract("namesJson", '$.en')),
    lower("namesJson" || ' ' || "firstAppearanceJson"), 0,
    json_extract("firstAppearanceJson", '$.workId'),
    "namesJson", "firstAppearanceJson", "speciesJson", "abilityDisplay",
    "abilityTagsJson", "affiliationsJson", "locationsJson", "rolesJson",
    "hairColorsJson", "playable", "enabledAsAnswer", "enabledAsGuess",
    "difficultyTier", "sourceRefsJson", "createdAt", "updatedAt"
FROM "Character";

DROP TABLE "Character";
ALTER TABLE "new_Character" RENAME TO "Character";
CREATE INDEX "Character_enabledAsGuess_nameSortKey_idx" ON "Character"("enabledAsGuess", "nameSortKey");
CREATE INDEX "Character_enabledAsGuess_appearanceOrder_idx" ON "Character"("enabledAsGuess", "appearanceOrder");
CREATE INDEX "Character_firstAppearanceWorkId_idx" ON "Character"("firstAppearanceWorkId");

CREATE TABLE "new_GameSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'character',
    "answerId" TEXT NOT NULL,
    "catalogVersion" TEXT NOT NULL,
    "puzzleKey" TEXT,
    "status" TEXT NOT NULL,
    "maxGuesses" INTEGER NOT NULL,
    "guessesJson" TEXT NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GameSession_catalogVersion_fkey" FOREIGN KEY ("catalogVersion") REFERENCES "CatalogSnapshot" ("version") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_GameSession" (
    "id", "mode", "contentType", "answerId", "catalogVersion", "status", "maxGuesses", "guessesJson", "version",
    "startedAt", "endedAt", "createdAt", "updatedAt"
)
SELECT
    "id", "mode", 'character', "answerId", 'legacy', "status", "maxGuesses", "guessesJson", 0,
    "startedAt", "endedAt", "createdAt", "updatedAt"
FROM "GameSession";

DROP TABLE "GameSession";
ALTER TABLE "new_GameSession" RENAME TO "GameSession";
CREATE INDEX "GameSession_mode_idx" ON "GameSession"("mode");
CREATE INDEX "GameSession_status_idx" ON "GameSession"("status");
CREATE INDEX "GameSession_catalogVersion_idx" ON "GameSession"("catalogVersion");

PRAGMA foreign_keys=ON;
