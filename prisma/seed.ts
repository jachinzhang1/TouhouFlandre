import {
  demoCatalogVersion,
  demoCharacters,
  demoWorks,
} from "@touhoufriberg/data";
import {
  characterNameSortKey,
  characterSearchText,
  normalizeSearchText,
} from "@touhoufriberg/shared";

process.env.DATABASE_URL ??= "file:./dev.db";

const { PrismaClient } = await import("@prisma/client");

const prisma = new PrismaClient();

const stringify = (value: unknown) => JSON.stringify(value);

async function main() {
  await prisma.$transaction(async (transaction) => {
    for (const work of demoWorks) {
      const data = {
        titleZh: work.titleZh,
        titleJa: work.titleJa,
        titleEn: work.titleEn,
        shortName: work.shortName,
        type: work.type,
        releaseYear: work.releaseYear,
        mainlineIndex: work.mainlineIndex,
        era: work.era,
      };
      await transaction.work.upsert({
        where: { id: work.id },
        update: data,
        create: { id: work.id, ...data },
      });
    }

    for (const character of demoCharacters) {
      const data = {
        avatarUrl: character.avatarUrl,
        displayName: character.names.zhHans,
        nameSortKey: characterNameSortKey(character),
        searchText: normalizeSearchText(characterSearchText(character)),
        appearanceOrder: character.appearanceOrder,
        firstAppearanceWorkId: character.firstAppearance.workId,
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
      };
      await transaction.character.upsert({
        where: { id: character.id },
        update: data,
        create: { id: character.id, ...data },
      });
    }

    await transaction.character.deleteMany({
      where: { id: { notIn: demoCharacters.map((character) => character.id) } },
    });
    await transaction.work.deleteMany({
      where: { id: { notIn: demoWorks.map((work) => work.id) } },
    });

    await transaction.catalogSnapshot.upsert({
      where: { version: demoCatalogVersion },
      update: { charactersJson: stringify(demoCharacters) },
      create: {
        version: demoCatalogVersion,
        charactersJson: stringify(demoCharacters),
      },
    });
    await transaction.catalogState.upsert({
      where: { id: "current" },
      update: { currentVersion: demoCatalogVersion },
      create: { id: "current", currentVersion: demoCatalogVersion },
    });
  });

  console.log(
    `Seeded catalog ${demoCatalogVersion}: ${demoWorks.length} works and ${demoCharacters.length} characters.`,
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
