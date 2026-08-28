import type {
  CatalogSearchIndex,
  CharacterSearchPolicy,
  CharacterSearchResponse,
} from "@touhouflandre/shared";
import { searchCharacters } from "./engine";
import { CatalogSearchIndexRepository, SearchIndexHttpError } from "./indexRepository";
import {
  defaultRemoteSearchAdapter,
  defaultSearchPolicyClient,
  type FallbackReason,
  type RemoteSearchAdapter,
  type SearchPolicyClient,
  type SearchPolicyPayload,
  type SearchRequestParams,
} from "./searchApi";

export type SearchContextKind = "catalog" | "single-session" | "multiplayer-match";

export type HybridSearchRequest = SearchRequestParams & {
  contextKind?: SearchContextKind;
  selectedCharacterIds?: readonly string[];
  gameScopeMode?: "strict" | "full";
  retry?: boolean;
};

type ValidPolicy = Omit<CharacterSearchPolicy, "gameScopeMode"> & {
  gameScopeMode?: "strict" | "full";
};

type Clock = () => number;
type Jitter = (value: number) => number;
type Circuit = {
  kind: "transient" | "structural";
  stage: number;
  nextProbeAt: number;
  probing: boolean;
};

export const POLICY_TIMEOUT_MS = 3_000;
export const INDEX_TIMEOUT_MS = 5_000;
export const LAST_KNOWN_GOOD_MS = 5 * 60_000;
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 300_000] as const;

export class SearchTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchTimeoutError";
  }
}

const isAbort = (error: unknown) =>
  error instanceof DOMException ? error.name === "AbortError" :
    error instanceof Error && error.name === "AbortError";

function normalizePolicy(value: SearchPolicyPayload): ValidPolicy {
  if (value.mode !== "remote" && value.mode !== "local-primary") throw new Error("invalid policy mode");
  const indexSchemaVersion = value.indexSchemaVersion;
  if (typeof indexSchemaVersion !== "number" || !Number.isInteger(indexSchemaVersion) || indexSchemaVersion < 1) throw new Error("invalid policy schema");
  const schemaVersion = indexSchemaVersion as number;
  if (typeof value.revision !== "string" || value.revision === "") throw new Error("invalid policy revision");
  if (value.gameScopeMode !== undefined && value.gameScopeMode !== "strict" && value.gameScopeMode !== "full") {
    throw new Error("invalid policy scope");
  }
  return {
    mode: value.mode,
    indexSchemaVersion: schemaVersion,
    revision: value.revision,
    gameScopeMode: value.gameScopeMode,
    revalidateAfterSeconds: 60,
  };
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  controller: AbortController,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new SearchTimeoutError(`request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function resultFromIndex(index: CatalogSearchIndex, request: HybridSearchRequest): CharacterSearchResponse {
  const local = searchCharacters(index, {
    query: request.q,
    allowedIds: request.selectedCharacterIds,
    workIds: request.workIds?.split(",").filter(Boolean),
    sortBy: request.sort,
    direction: request.direction,
    offset: request.offset,
    limit: request.limit,
  });
  return {
    total: local.total,
    results: local.results.map((entry) => ({ ...entry, searchText: entry.searchTerms.join(" ") })),
  };
}

export type SearchRouterOptions = {
  policyClient?: SearchPolicyClient;
  indexRepository?: CatalogSearchIndexRepository;
  remoteSearch?: RemoteSearchAdapter;
  now?: Clock;
  jitter?: Jitter;
};

export class CharacterSearchRouter {
  private readonly policyClient: SearchPolicyClient;
  private readonly indexRepository: CatalogSearchIndexRepository;
  private readonly remoteSearch: RemoteSearchAdapter;
  private readonly now: Clock;
  private readonly jitter: Jitter;
  private policy: ValidPolicy | null = null;
  private policyLoadedAt = 0;
  private policyInFlight: Promise<ValidPolicy> | null = null;
  private policyController: AbortController | null = null;
  private readonly loadedIndexes = new Set<string>();
  private readonly circuits = new Map<string, Circuit>();
  private disposed = false;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onVisibility = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") void this.refreshPolicy().catch(() => undefined);
  };

  constructor(options: SearchRouterOptions = {}) {
    this.policyClient = options.policyClient ?? defaultSearchPolicyClient;
    this.indexRepository = options.indexRepository ?? new CatalogSearchIndexRepository();
    this.remoteSearch = options.remoteSearch ?? defaultRemoteSearchAdapter;
    this.now = options.now ?? (() => Date.now());
    this.jitter = options.jitter ?? ((value) => value * (0.8 + Math.random() * 0.4));
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.onVisibility);
  }

  prefersLocal(request: HybridSearchRequest): boolean {
    return Boolean(request.catalogVersion) &&
      (request.contextKind === undefined || request.contextKind === "catalog" || request.selectedCharacterIds !== undefined);
  }

  async search(request: HybridSearchRequest, signal: AbortSignal): Promise<CharacterSearchResponse> {
    if (this.disposed) throw new DOMException("The operation was aborted", "AbortError");
    let policy = this.policy;
    let policyReason: FallbackReason | undefined;
    if (!policy || this.now() - this.policyLoadedAt >= (policy.revalidateAfterSeconds * 1000)) {
      try {
        policy = await this.refreshPolicy();
      } catch (error) {
        if (isAbort(error)) throw error;
        policyReason = this.isPolicyRouteMissing(error) ? undefined : "policy_unavailable";
        if (this.isTransientPolicyError(error) && this.canUseLastKnownGood(request)) {
          return this.searchLocal(request, signal, this.policy!, false);
        }
      }
    }
    if (!policy) return this.remoteSearch.search(this.remoteParams(request), signal, policyReason);
    if (policy.mode === "remote") return this.remoteSearch.search(this.remoteParams(request), signal, "policy_remote");
    if (!this.isLocalContextComplete(request, policy)) {
      return this.remoteSearch.search(this.remoteParams(request), signal, "context_incomplete");
    }
    return this.searchLocal(request, signal, policy, Boolean(request.retry));
  }

  dispose(): void {
    this.disposed = true;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisibility);
    this.policyController?.abort();
    this.policyController = null;
    this.policyInFlight = null;
  }

  private remoteParams(request: HybridSearchRequest): SearchRequestParams {
    const { contextKind, selectedCharacterIds: _selected, gameScopeMode: _scope, retry: _retry, ...params } = request;
    if (contextKind === "single-session" || contextKind === "multiplayer-match") {
      params.catalogVersion = undefined;
    }
    return params;
  }

  private async refreshPolicy(): Promise<ValidPolicy> {
    if (this.policyInFlight) return this.policyInFlight;
    const controller = new AbortController();
    this.policyController = controller;
    const pending = withTimeout(this.policyClient.get(controller.signal), POLICY_TIMEOUT_MS, controller)
      .then((payload) => {
        const next = normalizePolicy(payload);
        const revisionChanged = this.policy?.revision !== next.revision;
        this.policy = next;
        this.policyLoadedAt = this.now();
        if (revisionChanged) this.circuits.clear();
        this.scheduleRefresh(next.revalidateAfterSeconds);
        return next;
      })
      .finally(() => {
        if (this.policyInFlight === pending) this.policyInFlight = null;
        if (this.policyController === controller) this.policyController = null;
      });
    this.policyInFlight = pending;
    return pending;
  }

  private scheduleRefresh(seconds: number): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    const spread = Math.max(45, Math.min(60, 45 + Math.floor(Math.random() * 16)));
    this.refreshTimer = setTimeout(() => { void this.refreshPolicy().catch(() => undefined); }, spread * 1000);
  }

  private isLocalContextComplete(request: HybridSearchRequest, policy: ValidPolicy): boolean {
    if (!request.catalogVersion) return false;
    if (request.contextKind === undefined || request.contextKind === "catalog") return true;
    if (policy.gameScopeMode !== "strict" && policy.gameScopeMode !== "full") return false;
    if (policy.gameScopeMode === "full") return false;
    return Array.isArray(request.selectedCharacterIds) && request.selectedCharacterIds.length > 0 &&
      request.selectedCharacterIds.every((id) => typeof id === "string" && id.length > 0);
  }

  private canUseLastKnownGood(request: HybridSearchRequest): boolean {
    if (!this.policy || this.policy.mode !== "local-primary") return false;
    if (this.now() - this.policyLoadedAt > LAST_KNOWN_GOOD_MS || !request.catalogVersion) return false;
    return this.loadedIndexes.has(this.key(request.catalogVersion, this.policy));
  }

  private key(catalogVersion: string, policy: ValidPolicy): string {
    return `${catalogVersion}:${policy.indexSchemaVersion}:${policy.revision}`;
  }

  private async searchLocal(request: HybridSearchRequest, signal: AbortSignal, policy: ValidPolicy, explicitRetry: boolean): Promise<CharacterSearchResponse> {
    const key = this.key(request.catalogVersion!, policy);
    const circuit = this.circuits.get(key);
    const now = this.now();
    if (circuit?.kind === "structural") {
      if (!explicitRetry || circuit.probing) return this.remoteSearch.search(this.remoteParams(request), signal, "index_invalid");
      circuit.probing = true;
    }
    if (circuit?.kind === "transient") {
      if (now < circuit.nextProbeAt || circuit.probing) return this.remoteSearch.search(this.remoteParams(request), signal, "index_transient");
      circuit.probing = true;
    }
    const indexController = new AbortController();
    const forwardAbort = () => indexController.abort();
    try {
      if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
      signal.addEventListener("abort", forwardAbort, { once: true });
      const index = await withTimeout(
        this.indexRepository.load(request.catalogVersion!, policy.indexSchemaVersion, indexController.signal, policy.revision),
        INDEX_TIMEOUT_MS,
        indexController,
      );
      signal.removeEventListener("abort", forwardAbort);
      this.loadedIndexes.add(key);
      this.circuits.delete(key);
      return resultFromIndex(index, request);
    } catch (error) {
      signal.removeEventListener("abort", forwardAbort);
      if (isAbort(error)) throw error;
      const structural = this.isStructuralIndexError(error);
      if (circuit?.kind === "transient" && circuit.probing) circuit.probing = false;
      if (structural) {
        this.circuits.set(key, { kind: "structural", stage: 0, nextProbeAt: Number.POSITIVE_INFINITY, probing: false });
        return this.remoteSearch.search(this.remoteParams(request), signal, "index_invalid");
      }
      const stage = Math.min(circuit ? circuit.stage + 1 : 0, RETRY_DELAYS_MS.length - 1);
      const retryAfter = error instanceof SearchIndexHttpError && error.status === 429 ? error.retryAfterMs : undefined;
      const delay = Math.min(300_000, retryAfter ?? this.jitter(RETRY_DELAYS_MS[stage]));
      this.circuits.set(key, { kind: "transient", stage, nextProbeAt: this.now() + delay, probing: false });
      return this.remoteSearch.search(this.remoteParams(request), signal, "index_transient");
    }
  }

  private isStructuralIndexError(error: unknown): boolean {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
    if (["INVALID_INDEX", "UNSUPPORTED_SCHEMA", "VERSION_MISMATCH", "DUPLICATE_ID", "INVALID_ENTRY"].includes(code)) return true;
    const status = error && typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status) : Number.NaN;
    if ([400, 404].includes(status)) return true;
    return error instanceof Error && /(?:failed: )?(?:400|404)\b/.test(error.message);
  }

  private isTransientPolicyError(error: unknown): boolean {
    if (error instanceof SearchTimeoutError) return true;
    if (error instanceof TypeError) return true;
    const status = error && typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status) : Number.NaN;
    return status === 408 || status === 429 || status >= 500;
  }

  private isPolicyRouteMissing(error: unknown): boolean {
    const status = error && typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status) : Number.NaN;
    return status === 404 || status === 405;
  }
}
