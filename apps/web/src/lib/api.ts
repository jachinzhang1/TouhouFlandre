import createClient from "openapi-fetch";
import type { paths } from "../generated/api";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

const client = createClient<paths>({ baseUrl: API_BASE_URL });

type ApiResult<T> = { data?: T; error?: { error?: string } };

const requestApi = async <T>(
  promise: Promise<ApiResult<T>>,
): Promise<T> => {
  const { data, error } = await promise;
  if (error) throw new Error(error.error ?? "请求失败。");
  if (data === undefined) throw new Error("请求失败。");
  return data;
};

export const api = {
  searchCharacters: (
    params: NonNullable<paths["/api/characters/search"]["get"]["parameters"]>["query"],
    signal?: AbortSignal,
  ) =>
    requestApi(
      client.GET("/api/characters/search", { params: { query: params }, signal }),
    ),
  catalog: (signal?: AbortSignal) =>
    requestApi(client.GET("/api/catalog", { signal })),
  createPuzzle: (mode: "daily" | "random") =>
    requestApi(
      client.POST("/api/puzzles/{mode}", { params: { path: { mode } } }),
    ),
  submitGuess: async (sessionId: string, guessId: string) => {
    const { session } = await requestApi(
      client.POST("/api/sessions/{sessionId}/guess", {
        params: { path: { sessionId } },
        body: { guessId },
      }),
    );
    return session;
  },
  getSession: async (sessionId: string) => {
    const { session } = await requestApi(
      client.GET("/api/sessions/{sessionId}", {
        params: { path: { sessionId } },
      }),
    );
    return session;
  },
};
