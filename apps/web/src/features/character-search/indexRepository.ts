import type { CatalogSearchIndex } from "@touhouflandre/shared";
import { SearchIndexValidationError, validateSearchIndex } from "./schema";

export type IndexRepositoryOptions = {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
};

export class SearchIndexHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs?: number,
    readonly code?: string,
  ) {
    super(`search index request failed: ${status}`);
    this.name = "SearchIndexHttpError";
  }
}

type Key = `${string}:${number}`;

export class CatalogSearchIndexRepository {
  private readonly values = new Map<Key, CatalogSearchIndex>();
  private readonly inFlight = new Map<Key, Promise<CatalogSearchIndex>>();
  private readonly controllers = new Map<Key, AbortController>();
  private readonly repairAttempts = new Set<string>();
  private readonly consumers = new Map<Key, number>();
  private readonly fetcher: typeof globalThis.fetch;
  private readonly baseUrl: string;

  constructor(options: IndexRepositoryOptions = {}) {
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = options.baseUrl ?? "";
  }

  load(
    catalogVersion: string,
    indexSchemaVersion = 1,
    signal?: AbortSignal,
    policyRevision = "v1",
  ): Promise<CatalogSearchIndex> {
    const key = `${catalogVersion}:${indexSchemaVersion}` as Key;
    const existing = this.values.get(key);
    if (existing)
      return this.consumerPromise(Promise.resolve(existing), key, signal);
    let shared = this.inFlight.get(key);
    if (!shared) {
      const controller = new AbortController();
      this.controllers.set(key, controller);
      shared = this.fetchAndValidate(
        catalogVersion,
        indexSchemaVersion,
        undefined,
        controller.signal,
      ).catch(async (error) => {
        if (
          !(error instanceof Error) ||
          !["INVALID_INDEX", "UNSUPPORTED_SCHEMA", "VERSION_MISMATCH"].includes(
            (error as { code?: string }).code ?? "",
          )
        )
          throw error;
        return this.repair(
          key,
          catalogVersion,
          indexSchemaVersion,
          policyRevision,
        );
      });
      this.inFlight.set(key, shared);
      void shared
        .then(
          (value) => this.values.set(key, value),
          () => undefined,
        )
        .finally(() => {
          this.inFlight.delete(key);
          this.controllers.delete(key);
        });
    }
    return this.consumerPromise(shared, key, signal);
  }

  clear(catalogVersion: string, indexSchemaVersion = 1): void {
    this.values.delete(`${catalogVersion}:${indexSchemaVersion}` as Key);
  }

  private async repair(
    key: Key,
    catalogVersion: string,
    schemaVersion: number,
    policyRevision: string,
  ): Promise<CatalogSearchIndex> {
    const repairKey = `${key}:repair:${policyRevision}`;
    if (this.repairAttempts.has(repairKey)) {
      throw new SearchIndexValidationError(
        "INVALID_INDEX",
        "index repair already attempted",
      );
    }
    this.repairAttempts.add(repairKey);
    if (this.inFlight.has(repairKey as Key))
      return this.inFlight.get(repairKey as Key)!;
    const promise = this.fetchAndValidate(
      catalogVersion,
      schemaVersion,
      "reload",
    ).finally(() => this.inFlight.delete(repairKey as Key));
    this.inFlight.set(repairKey as Key, promise);
    return promise;
  }

  private async fetchAndValidate(
    version: string,
    schemaVersion: number,
    cache?: RequestCache,
    signal?: AbortSignal,
  ): Promise<CatalogSearchIndex> {
    const url = `${this.baseUrl}/api/catalog/${encodeURIComponent(version)}/search-index/${schemaVersion}`;
    const response = await this.fetcher(
      url,
      cache ? { cache, signal } : { signal },
    );
    if (!response.ok) {
      const retryAfter = response.headers.get("Retry-After");
      const seconds =
        retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter)
          ? Number(retryAfter) * 1000
          : undefined;
      let code: string | undefined;
      try {
        const payload = (await response.clone().json()) as { code?: unknown };
        if (typeof payload.code === "string" && payload.code !== "")
          code = payload.code;
      } catch {
        // Older API binaries may return an empty/non-JSON route-missing response.
      }
      if (
        code === undefined &&
        (response.status === 404 || response.status === 405)
      ) {
        code = "COMPATIBILITY_ROUTE_MISSING";
      }
      throw new SearchIndexHttpError(response.status, seconds, code);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new SearchIndexValidationError(
        "INVALID_INDEX",
        "search index JSON is invalid",
      );
    }
    return validateSearchIndex(body, version, schemaVersion);
  }

  private consumerPromise(
    promise: Promise<CatalogSearchIndex>,
    key: Key,
    signal?: AbortSignal,
  ): Promise<CatalogSearchIndex> {
    if (!signal) return promise;
    this.consumers.set(key, (this.consumers.get(key) ?? 0) + 1);
    return new Promise((resolve, reject) => {
      let settled = false;
      const release = () => {
        if (settled) return;
        settled = true;
        const count = (this.consumers.get(key) ?? 1) - 1;
        if (count <= 0) {
          this.consumers.delete(key);
          const controller = this.controllers.get(key);
          if (controller) controller.abort();
          this.inFlight.delete(key);
        } else this.consumers.set(key, count);
      };
      const abort = () => {
        release();
        reject(new DOMException("The operation was aborted", "AbortError"));
      };
      if (signal.aborted) return abort();
      signal.addEventListener("abort", abort, { once: true });
      promise.then(
        (value) => {
          if (!settled) {
            release();
            resolve(value);
          }
        },
        (error) => {
          if (!settled) {
            release();
            reject(error);
          }
        },
      );
    });
  }
}
