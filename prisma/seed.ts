import { demoCharacters, demoWorks } from "@touhoufriberg/data";

process.env.DATABASE_URL ??= "file:./dev.db";

const { PrismaClient } = await import("@prisma/client");

const prisma = new PrismaClient();

const stringify = (value: unknown) => JSON.stringify(value);

async function main() {
  for (const work of demoWorks) {
    await prisma.work.upsert({
      where: { id: work.id },
      update: {
        titleZh: work.titleZh,
        titleJa: work.titleJa,
        titleEn: work.titleEn,
        shortName: work.shortName,
        type: work.type,
        releaseYear: work.releaseYear,
        mainlineIndex: work.mainlineIndex,
        era: work.era,
      },
      create: {
        id: work.id,
        titleZh: work.titleZh,
        titleJa: work.titleJa,
        titleEn: work.titleEn,
        shortName: work.shortName,
        type: work.type,
        releaseYear: work.releaseYear,
        mainlineIndex: work.mainlineIndex,
        era: work.era,
      },
    });
  }

  for (const character of demoCharacters) {
    await prisma.character.upsert({
      where: { id: character.id },
      update: {
        avatarUrl: character.avatarUrl,
        namesJson: stringify(character.names),
        firstAppearanceJson: stringify(character.firstAppearance),
        speciesJson: stringify(character.species),
        abilityDisplay: character.abilityDisplay,
        abilityTagsJson: stringify(character.abilityTags),
        affiliationsJson: stringify(character.affiliations),
        locationsJson: stringify(character.locations),
        rolesJson: stringify(character.roles),
        hairColorsJson: stringify(character.hairColors),
        playable: character.playable,
        enabledAsAnswer: character.enabledAsAnswer,
        enabledAsGuess: character.enabledAsGuess,
        difficultyTier: character.difficultyTier,
        sourceRefsJson: stringify(character.sourceRefs),
      },
      create: {
        id: character.id,
        avatarUrl: character.avatarUrl,
        namesJson: stringify(character.names),
        firstAppearanceJson: stringify(character.firstAppearance),
        speciesJson: stringify(character.species),
        abilityDisplay: character.abilityDisplay,
        abilityTagsJson: stringify(character.abilityTags),
        affiliationsJson: stringify(character.affiliations),
        locationsJson: stringify(character.locations),
        rolesJson: stringify(character.roles),
        hairColorsJson: stringify(character.hairColors),
        playable: character.playable,
        enabledAsAnswer: character.enabledAsAnswer,
        enabledAsGuess: character.enabledAsGuess,
        difficultyTier: character.difficultyTier,
        sourceRefsJson: stringify(character.sourceRefs),
      },
    });
  }

  console.log(
    `Seeded ${demoWorks.length} works and ${demoCharacters.length} characters.`,
  );
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
