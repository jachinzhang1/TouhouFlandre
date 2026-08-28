import createClient from "openapi-fetch";
import type { CharacterSearchPolicy, CharacterSearchResponse } from "@touhouflandre/shared";
import type { paths } from "../../generated/api";

export type SearchRequestParams = NonNullable<
  paths["/api/characters/search"]["get"]["parameters"]
>["query"];

export type FallbackReason =
  | "policy_remote"
  | "policy_unavailable"
  | "context_incomplete"
  | "index_transient"
  | "index_invalid"
  | "engine_error";

export type SearchPolicyPayload = Partial<CharacterSearchPolicy> & {
  mode?: unknown;
  indexSchemaVersion?: unknown;
  revision?: unknown;
  gameScopeMode?: unknown;
  revalidateAfterSeconds?: unknown;
};

export type SearchPolicyClient = {
  get(signal: AbortSignal): Promise<SearchPolicyPayload>;
};

export type RemoteSearchAdapter = {
  search(
    params: SearchRequestParams,
    signal: AbortSignal,
    fallbackReason?: FallbackReason,
  ): Promise<CharacterSearchResponse>;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export class SearchApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "SearchApiError";
  }
}

export const defaultSearchPolicyClient: SearchPolicyClient = {
  async get(signal) {
    const response = await fetch(`${API_BASE_URL}/api/catalog/search-policy`, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal,
    });
    if (!response.ok) throw new SearchApiError("搜索策略请求失败。", response.status);
    try {
      return (await response.json()) as SearchPolicyPayload;
    } catch {
      throw new SearchApiError("搜索策略响应无效。", response.status);
    }
  },
};

const client = createClient<paths>({ baseUrl: API_BASE_URL });

export const defaultRemoteSearchAdapter: RemoteSearchAdapter = {
  async search(params, signal, fallbackReason) {
    const headers = fallbackReason
      ? { "X-Character-Search-Fallback-Reason": fallbackReason }
      : undefined;
    try {
      const result = await client.GET("/api/characters/search", {
        params: { query: params },
        headers,
        signal,
      });
      if (result.error || !result.response.ok) {
        throw new SearchApiError(
          result.error?.error ?? "搜索失败。",
          result.response.status,
        );
      }
      return result.data as CharacterSearchResponse;
    } catch (error) {
      // A rejected CORS preflight is surfaced by fetch as TypeError. Retry once
      // without the observational header; business parameters remain identical.
      if (fallbackReason && error instanceof TypeError && !signal.aborted) {
        const retry = await client.GET("/api/characters/search", {
          params: { query: params },
          signal,
        });
        if (retry.error || !retry.response.ok) {
          throw new SearchApiError(
            retry.error?.error ?? "搜索失败。",
            retry.response.status,
          );
        }
        return retry.data as CharacterSearchResponse;
      }
      throw error;
    }
  },
};
