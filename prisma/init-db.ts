process.env.DATABASE_URL ??= "file:./dev.db";

const { PrismaClient } = await import("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Character" (
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
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Work" (
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
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "GameSession" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "mode" TEXT NOT NULL,
      "answerId" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "maxGuesses" INTEGER NOT NULL,
      "guessesJson" TEXT NOT NULL DEFAULT '[]',
      "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "endedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "GameSession_mode_idx" ON "GameSession"("mode");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "GameSession_status_idx" ON "GameSession"("status");`);
  console.log("SQLite tables are ready.");
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
