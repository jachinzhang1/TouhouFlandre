import { StrictMode, useEffect } from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  CharacterSearchProvider,
  useCharacterSearchRouter,
} from "./CharacterSearchProvider";

function RouterProbe({ onRouter }: { onRouter: (value: unknown) => void }) {
  const router = useCharacterSearchRouter();
  useEffect(() => onRouter(router), [onRouter, router]);
  return null;
}

describe("CharacterSearchProvider", () => {
  it("keeps the router usable across React StrictMode effect probes", async () => {
    const onRouter = vi.fn();
    render(
      <StrictMode>
        <CharacterSearchProvider
          policyClient={{
            get: vi.fn().mockResolvedValue({
              mode: "remote",
              indexSchemaVersion: 1,
              revision: "test",
            }),
          }}
          remoteSearch={{
            search: vi.fn().mockResolvedValue({ results: [], total: 0 }),
          }}
        >
          <RouterProbe onRouter={onRouter} />
        </CharacterSearchProvider>
      </StrictMode>,
    );

    await waitFor(() => expect(onRouter).toHaveBeenCalled());
    const router = onRouter.mock.lastCall?.[0] as {
      search: (request: { q: string }, signal: AbortSignal) => Promise<unknown>;
    };
    await expect(
      router.search({ q: "" }, new AbortController().signal),
    ).resolves.toBeDefined();
  });
});
