import createClient from "openapi-fetch";
import type { PublicGameSession } from "@touhouflandre/shared";
import type { components, paths } from "../generated/api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export type PuzzleResolveRequest =
  components["schemas"]["PuzzleResolveRequest"];
export type PuzzleResolveResponse = {
  puzzleLabel: string;
  session: PublicGameSession;
  resolution: "created" | "resumed";
  supersededSession?: PublicGameSession;
};

export class PuzzleApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "PuzzleApiError";
  }
}

export class PuzzleResolveUnsupportedError extends PuzzleApiError {
  constructor(status?: number) {
    super("当前 API 不支持题局恢复接口。", status);
    this.name = "PuzzleResolveUnsupportedError";
  }
}

export type PuzzleApi = {
  resolvePuzzle(
    mode: "daily" | "random",
    body: PuzzleResolveRequest,
  ): Promise<PuzzleResolveResponse>;
};

export function createPuzzleApi(): PuzzleApi {
  const client = createClient<paths>({ baseUrl: API_BASE_URL });
  let resolveUnsupported = false;

  return {
    async resolvePuzzle(mode, body) {
      if (resolveUnsupported) throw new PuzzleResolveUnsupportedError();

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const result = await client.POST("/api/puzzles/{mode}/resolve", {
            params: { path: { mode } },
            body,
          });
          if (
            result.response.status === 404 ||
            result.response.status === 405
          ) {
            resolveUnsupported = true;
            throw new PuzzleResolveUnsupportedError(result.response.status);
          }
          if (result.error || !result.response.ok) {
            throw new PuzzleApiError(
              result.error?.error ?? "加载游戏失败。",
              result.response.status,
              result.error?.code,
            );
          }
          return result.data as PuzzleResolveResponse;
        } catch (error) {
          if (error instanceof PuzzleResolveUnsupportedError) throw error;
          if (attempt === 0 && error instanceof TypeError) continue;
          throw error;
        }
      }
      throw new PuzzleApiError("加载游戏失败。");
    },
  };
}
