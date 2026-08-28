import { readFileSync } from "node:fs";
import { expect, describe, it } from "vitest";

type SearchParityFixture = {
  contract: string;
  catalogVersion: string;
  indexSchemaVersion: number;
  characters: Array<{
    id: string;
    firstAppearance: {
      workId: string;
    };
  }>;
  cases: Array<{
    name: string;
    query: string;
    selectedCharacterIds: string[] | null;
    workIds: string[] | null;
    sortBy: string;
    descending: boolean;
    offset: number;
    limit: number;
    expected: { ids: string[]; total: number };
  }>;
};

type FailureMatrixFixture = {
  contract: string;
  catalogVersion: string;
  indexSchemaVersion: number;
  policyRevision: string;
  fallbackReasons: string[];
  cases: Array<{
    name: string;
    state: {
      hasValidatedPolicy: boolean;
      hasLoadedIndex: boolean;
      catalogVersion: string;
      indexSchemaVersion: number;
      policyRevision: string | null;
      lastKnownGoodAgeSeconds: number | null;
      retryStage: number;
      cacheState?: string;
      circuitOpen?: boolean;
    };
    policyResponse: { kind: string } | null;
    indexResponse: { kind: string } | null;
    expected: {
      resultSource: string;
      faultClass: string;
      nextProbeAfterSeconds: number | null;
      fallbackReason: string;
    };
  }>;
};

type CompatibilityMatrixFixture = {
  contract: string;
  cases: Array<{
    name: string;
    web: string;
    api: string;
    policyMode: string;
    indexState: string;
    policyState: string;
    expected: {
      searchRoute: string;
      puzzleFlow: string;
      compatibilityReason: string;
    };
  }>;
};

const readJson = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8")) as T;

const searchFixture = readJson<SearchParityFixture>(
  "../../../../docs/hybrid-search-optimization/fixtures/search-parity-v1.json",
);
const failureFixture = readJson<FailureMatrixFixture>(
  "../../../../docs/hybrid-search-optimization/fixtures/failure-matrix-v1.json",
);
const compatibilityFixture = readJson<CompatibilityMatrixFixture>(
  "../../../../docs/hybrid-search-optimization/fixtures/compatibility-matrix-v1.json",
);

describe("HSO-001 fixtures", () => {
  it("keeps the search parity sample language-neutral and referentially valid", () => {
    expect(searchFixture.contract).toBe("hso.search-parity.v1");
    expect(searchFixture.catalogVersion).toBeTruthy();
    expect(searchFixture.indexSchemaVersion).toBe(1);
    expect(searchFixture.cases).toHaveLength(20);

    const characterIds = new Set(
      searchFixture.characters.map((character) => character.id),
    );
    expect(characterIds.size).toBe(searchFixture.characters.length);
    const workIds = new Set(
      searchFixture.characters.map(
        (character) => character.firstAppearance.workId,
      ),
    );

    const caseNames = new Set<string>();
    let sawEmptyAllowedScope = false;
    for (const testCase of searchFixture.cases) {
      expect(caseNames.has(testCase.name)).toBe(false);
      caseNames.add(testCase.name);
      expect(["appearance", "name"]).toContain(testCase.sortBy);
      expect(testCase.expected.ids.length).toBeLessThanOrEqual(
        testCase.expected.total,
      );

      if (testCase.selectedCharacterIds === null) {
        // no-op
      } else {
        sawEmptyAllowedScope ||= testCase.selectedCharacterIds.length === 0;
        for (const selectedId of testCase.selectedCharacterIds) {
          expect(characterIds.has(selectedId)).toBe(true);
        }
      }

      if (testCase.workIds !== null) {
        for (const workId of testCase.workIds) {
          expect(workIds.has(workId)).toBe(true);
        }
      }
      for (const expectedId of testCase.expected.ids) {
        expect(characterIds.has(expectedId)).toBe(true);
      }
    }

    expect(caseNames.size).toBe(searchFixture.cases.length);
    expect(sawEmptyAllowedScope).toBe(true);
    for (const required of [
      "simplified chinese name",
      "traditional chinese name",
      "japanese name",
      "english name",
      "romaji name",
      "hyphen stripping",
      "middle dot stripping",
      "fullwidth th code",
      "work title",
      "work id",
      "work pinyin initials",
      "boundary negative",
      "disabled guesser excluded",
      "shared alias tie-break",
      "empty selected ids deny all",
      "filters before paging",
      "appearance pagination",
      "appearance descending",
      "name ascending",
      "name descending",
    ]) {
      expect(caseNames.has(required)).toBe(true);
    }
  });

  it("keeps the failure and compatibility matrices constrained", () => {
    expect(failureFixture.contract).toBe("hso.failure-matrix.v1");
    expect(failureFixture.catalogVersion).toBeTruthy();
    expect(failureFixture.indexSchemaVersion).toBe(1);
    expect(failureFixture.cases).toHaveLength(12);

    const allowedReasons = new Set([
      "policy_remote",
      "policy_unavailable",
      "context_incomplete",
      "index_transient",
      "index_invalid",
      "engine_error",
      "none",
    ]);
    const failureNames = new Set<string>();
    for (const testCase of failureFixture.cases) {
      expect(failureNames.has(testCase.name)).toBe(false);
      failureNames.add(testCase.name);
      expect(allowedReasons.has(testCase.expected.fallbackReason)).toBe(true);
      if (testCase.expected.nextProbeAfterSeconds !== null) {
        expect(testCase.expected.nextProbeAfterSeconds).toBeGreaterThanOrEqual(
          0,
        );
      }
    }
    expect(failureNames.size).toBe(failureFixture.cases.length);
    expect(failureFixture.fallbackReasons).toEqual(
      expect.arrayContaining([
        "policy_remote",
        "policy_unavailable",
        "context_incomplete",
        "index_transient",
        "index_invalid",
        "engine_error",
      ]),
    );
    for (const required of [
      "policy cold start 404",
      "policy cold start 405",
      "policy timeout at three seconds",
      "index timeout first probe",
      "index timeout second probe",
      "index timeout third probe",
      "index timeout fourth probe",
      "last known good within five minutes",
      "last known good expired",
      "cache repair succeeds",
      "cache repair fails",
      "policy revision change resets circuit",
    ]) {
      expect(failureNames.has(required)).toBe(true);
    }

    expect(compatibilityFixture.contract).toBe("hso.compatibility-matrix.v1");
    expect(compatibilityFixture.cases).toHaveLength(8);
    const combos = new Set(
      compatibilityFixture.cases.map(
        (testCase) => `${testCase.web}/${testCase.api}`,
      ),
    );
    expect(combos).toEqual(
      new Set(["old/old", "old/new", "new/old", "new/new"]),
    );
    const policyModes = new Set(
      compatibilityFixture.cases.map((testCase) => testCase.policyMode),
    );
    expect(policyModes).toEqual(new Set(["remote", "local-primary"]));
    for (const required of [
      "old web with old api",
      "old web with new api",
      "new web with old api",
      "new web with new api remote",
      "new web with new api local-primary",
      "new web with new api local-primary and index failure",
      "new web with new api local-primary and policy failure",
      "old web with new api local-primary",
    ]) {
      expect(
        compatibilityFixture.cases.some(
          (testCase) => testCase.name === required,
        ),
      ).toBe(true);
    }
  });
});
