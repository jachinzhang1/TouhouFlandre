CREATE TABLE "Character" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "Work" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "titleZh" TEXT NOT NULL,
    "titleJa" TEXT NOT NULL,
    "titleEn" TEXT,
    "shortName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "releaseYear" INTEGER NOT NULL,
    "mainlineIndex" INTEGER,
    "era" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "GameSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL,
    "answerId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "maxGuesses" INTEGER NOT NULL,
    "guessesJson" TEXT NOT NULL DEFAULT '[]',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "GameSession_mode_idx" ON "GameSession"("mode");
CREATE INDEX "GameSession_status_idx" ON "GameSession"("status");
