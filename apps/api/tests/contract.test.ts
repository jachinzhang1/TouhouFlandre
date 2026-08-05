// 契约测试：请求真实 Express 服务，校验响应状态码与响应体符合 OpenAPI 规范。
// 覆盖全部 6 个端点的无数据库路径（CI 无需 seed 即可运行）；
// seed 后的成功路径由本地/E2E 回归覆盖。
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import SwaggerParser from "@apidevtools/swagger-parser";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";

// 契约测试运行在隔离的空 SQLite 上：catalog 未 seed 时稳定返回 503，
// 且不依赖开发库内容。必须在 import db 模块前设置。
process.env.DATABASE_URL = `file:${join(
  tmpdir(),
  `contract-test-${process.pid}-${Date.now()}.db`,
)}`;

const { createApp } = await import("../src/app");
const { prisma } = await import("../src/db");

// 空库没有表，先按 schema 建表（不生成 client、不 seed）。
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
execFileSync("pnpm", ["exec", "prisma", "db", "push", "--skip-generate"], {
  cwd: repoRoot,
  env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
  stdio: "pipe",
});

const openapiPath = fileURLToPath(
  new URL("../../../contracts/openapi/openapi.yaml", import.meta.url),
);

type OpenApiDoc = Awaited<ReturnType<typeof SwaggerParser.dereference>>;

let api: OpenApiDoc;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  api = (await SwaggerParser.dereference(openapiPath)) as OpenApiDoc;
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

const responseSchemaFor = (
  path: string,
  method: "get" | "post",
  status: number,
) => {
  const operation = api.paths[path]?.[method];
  expect(operation, `missing operation ${method.toUpperCase()} ${path}`).toBeDefined();
  const response = operation?.responses?.[String(status)];
  expect(
    response,
    `missing ${status} response for ${method.toUpperCase()} ${path}`,
  ).toBeDefined();
  return response?.content?.["application/json"]?.schema;
};

const validateAgainst = (path: string, method: "get" | "post", status: number, body: unknown) => {
  const schema = responseSchemaFor(path, method, status);
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const ok = validate(body);
  return { ok, errors: validate.errors };
};

describe("contract: response shape matches OpenAPI", () => {
  it("health returns 200 with ok/service", async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(200);
    const body = await response.json();
    const { ok, errors } = validateAgainst("/api/health", "get", 200, body);
    expect(errors).toBeNull();
    expect(ok).toBe(true);
  });

  it("search returns 200 with CharacterSearchResponse on empty catalog", async () => {
    const response = await fetch(
      `${baseUrl}/api/characters/search?q=%E7%81%B5%E6%A2%A6`,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    const { ok, errors } = validateAgainst(
      "/api/characters/search",
      "get",
      200,
      body,
    );
    expect(errors).toBeNull();
    expect(ok).toBe(true);
  });

  it("search rejects invalid sort with 400 ErrorResponse", async () => {
    const response = await fetch(
      `${baseUrl}/api/characters/search?sort=unsupported`,
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    const { ok, errors } = validateAgainst(
      "/api/characters/search",
      "get",
      400,
      body,
    );
    expect(errors).toBeNull();
    expect(ok).toBe(true);
  });

  it("catalog returns 503 ErrorResponse when catalog is not seeded", async () => {
    const response = await fetch(`${baseUrl}/api/catalog`);
    expect(response.status).toBe(503);
    const body = await response.json();
    const { ok, errors } = validateAgainst("/api/catalog", "get", 503, body);
    expect(errors).toBeNull();
    expect(ok).toBe(true);
  });

  it("puzzles rejects unsupported mode with 400 ErrorResponse", async () => {
    const response = await fetch(`${baseUrl}/api/puzzles/unsupported`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    const { ok, errors } = validateAgainst(
      "/api/puzzles/{mode}",
      "post",
      400,
      body,
    );
    expect(errors).toBeNull();
    expect(ok).toBe(true);
  });

  it("guess on missing session returns 404 ErrorResponse", async () => {
    const response = await fetch(
      `${baseUrl}/api/sessions/missing-session/guess`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guessId: "reimu" }),
      },
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    const { ok, errors } = validateAgainst(
      "/api/sessions/{sessionId}/guess",
      "post",
      404,
      body,
    );
    expect(errors).toBeNull();
    expect(ok).toBe(true);
  });

  it("get session on missing session returns 404 ErrorResponse", async () => {
    const response = await fetch(
      `${baseUrl}/api/sessions/missing-session`,
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    const { ok, errors } = validateAgainst(
      "/api/sessions/{sessionId}",
      "get",
      404,
      body,
    );
    expect(errors).toBeNull();
    expect(ok).toBe(true);
  });
});
