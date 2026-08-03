import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { compareCharacter } from "@touhoufriberg/shared";
import { demoCharacters } from "@touhoufriberg/data";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { hydrateGuessAvatars, prisma } from "../src/db";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await prisma.$disconnect();
});

describe("API validation", () => {
  it("serves the health endpoint", async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });

  it("rejects unsupported character sort values", async () => {
    const response = await fetch(
      `${baseUrl}/api/characters/search?sort=unsupported`,
    );
    expect(response.status).toBe(400);
  });

  it("rejects unsupported puzzle modes", async () => {
    const response = await fetch(`${baseUrl}/api/puzzles/unsupported`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(400);
  });
});

describe("session compatibility", () => {
  it("restores avatar URLs missing from legacy guess records", () => {
    const guess = compareCharacter(demoCharacters[0], demoCharacters[1]);
    const { guessAvatarUrl: _legacyMissingField, ...legacyGuess } = guess;

    expect(
      hydrateGuessAvatars([legacyGuess], demoCharacters)[0].guessAvatarUrl,
    ).toBe(demoCharacters[0].avatarUrl);
  });
});
