import { act, render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MusicAudioAdapter,
  MusicAudioEvent,
  MusicAudioEventListener,
} from "./audioAdapter";
import type { MusicPlayerContextValue } from "./contracts";

const adapterMock = vi.hoisted(() => ({ factory: vi.fn() }));

vi.mock("./audioAdapter", async (importOriginal) => {
  const original = await importOriginal<typeof import("./audioAdapter")>();
  return { ...original, createHtmlAudioAdapter: adapterMock.factory };
});

import { MUSIC_CATALOG } from "./catalog";
import { MusicPlayerProvider, useMusicPlayer } from "./MusicPlayerProvider";

type ControlledAdapter = MusicAudioAdapter & {
  emit(
    type: MusicAudioEvent["type"],
    overrides?: Partial<MusicAudioEvent>,
  ): void;
  listenerCount(): number;
  playError: unknown;
  setSource: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  seek: ReturnType<typeof vi.fn>;
  setVolume: ReturnType<typeof vi.fn>;
  setMuted: ReturnType<typeof vi.fn>;
};

const adapters: ControlledAdapter[] = [];

function createControlledAdapter(): ControlledAdapter {
  let sourceToken = 0;
  let playbackIntent: "paused" | "playing" = "paused";
  let volume = 0.7;
  let muted = false;
  const listeners = new Set<MusicAudioEventListener>();

  const adapter: ControlledAdapter = {
    playError: null,
    setSource: vi.fn(() => {
      sourceToken += 1;
      return sourceToken;
    }),
    play: vi.fn(async () => {
      playbackIntent = "playing";
      if (adapter.playError) {
        playbackIntent = "paused";
        throw adapter.playError;
      }
    }),
    pause: vi.fn(() => {
      playbackIntent = "paused";
    }),
    seek: vi.fn(),
    setVolume: vi.fn((nextVolume: number) => {
      volume = nextVolume;
      if (nextVolume > 0) muted = false;
    }),
    setMuted: vi.fn((nextMuted: boolean) => {
      muted = nextMuted;
    }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getPlaybackIntent: () => playbackIntent,
    emit(type, overrides = {}) {
      const event: MusicAudioEvent = {
        type,
        sourceToken,
        currentTime: 0,
        duration: 120,
        volume,
        muted,
        error: null,
        ...overrides,
      };
      for (const listener of listeners) listener(event);
    },
    listenerCount: () => listeners.size,
  };
  adapters.push(adapter);
  return adapter;
}

let player: MusicPlayerContextValue;

function Probe() {
  player = useMusicPlayer();
  return <output data-testid="status">{player.state.status}</output>;
}

beforeEach(() => {
  adapters.length = 0;
  adapterMock.factory.mockReset();
  adapterMock.factory.mockImplementation(() => createControlledAdapter());
});

describe("MusicPlayerProvider", () => {
  it("loads the canonical first source and maps current media events", async () => {
    render(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>,
    );
    await waitFor(() => expect(adapters).toHaveLength(1));
    const adapter = adapters[0];

    expect(adapter.setSource).toHaveBeenCalledWith(MUSIC_CATALOG[0].audioUrl);
    expect(adapter.setVolume).toHaveBeenCalledWith(0.7);
    expect(adapter.setMuted).toHaveBeenCalledWith(false);

    act(() => {
      adapter.emit("loadedmetadata", { duration: 120 });
      adapter.emit("canplay");
    });
    expect(player.state).toMatchObject({
      currentTrack: MUSIC_CATALOG[0],
      duration: 120,
      status: "paused",
    });
  });

  it("normalizes optional initial preferences without restoring playback", async () => {
    render(
      <MusicPlayerProvider
        initialPreferences={{
          selectedTrackIds: [MUSIC_CATALOG[2].id, MUSIC_CATALOG[1].id],
          currentTrackId: MUSIC_CATALOG[2].id,
          volume: 0.4,
          muted: true,
          lastNonZeroVolume: 0.6,
        }}
      >
        <Probe />
      </MusicPlayerProvider>,
    );
    await waitFor(() => expect(adapters).toHaveLength(1));

    expect(player.state.queue.map((track) => track.id)).toEqual([
      MUSIC_CATALOG[1].id,
      MUSIC_CATALOG[2].id,
    ]);
    expect(player.state).toMatchObject({
      currentTrack: MUSIC_CATALOG[2],
      status: "loading",
      volume: 0.4,
      muted: true,
    });
    expect(adapters[0].setSource).toHaveBeenCalledWith(
      MUSIC_CATALOG[2].audioUrl,
    );
    expect(adapters[0].play).not.toHaveBeenCalled();
  });

  it("changes source once, ignores stale events and preserves canonical queue order", async () => {
    render(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>,
    );
    await waitFor(() => expect(adapters).toHaveLength(1));
    const adapter = adapters[0];

    act(() => player.commands.next());
    expect(adapter.setSource).toHaveBeenLastCalledWith(
      MUSIC_CATALOG[1].audioUrl,
    );
    expect(adapter.setSource).toHaveBeenCalledTimes(2);

    act(() => {
      adapter.emit("error", { sourceToken: 1, error: "stale failure" });
      adapter.emit("loadedmetadata", { sourceToken: 2, duration: 90 });
    });
    expect(player.state).toMatchObject({
      currentTrack: MUSIC_CATALOG[1],
      duration: 90,
      error: null,
    });

    act(() =>
      player.commands.applySelection([
        MUSIC_CATALOG[2].id,
        MUSIC_CATALOG[1].id,
      ]),
    );
    expect(player.state.queue.map((track) => track.id)).toEqual([
      MUSIC_CATALOG[1].id,
      MUSIC_CATALOG[2].id,
    ]);
    expect(adapter.setSource).toHaveBeenCalledTimes(2);
  });

  it("wraps transport commands and keeps playback intent across source changes", async () => {
    render(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>,
    );
    await waitFor(() => expect(adapters).toHaveLength(1));
    const adapter = adapters[0];

    act(() => player.commands.previous());
    expect(player.state.currentTrack).toBe(MUSIC_CATALOG[2]);
    expect(adapter.setSource).toHaveBeenLastCalledWith(
      MUSIC_CATALOG[2].audioUrl,
    );

    await act(async () => player.commands.play());
    act(() => adapter.emit("ended"));
    expect(player.state.currentTrack).toBe(MUSIC_CATALOG[0]);
    expect(adapter.setSource).toHaveBeenLastCalledWith(
      MUSIC_CATALOG[0].audioUrl,
    );
    act(() => adapter.emit("canplay"));
    await waitFor(() => expect(adapter.play).toHaveBeenCalledTimes(2));
  });

  it("changes to the first selected track when the current track is removed", async () => {
    render(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>,
    );
    await waitFor(() => expect(adapters).toHaveLength(1));
    const adapter = adapters[0];

    act(() => player.commands.applySelection([MUSIC_CATALOG[2].id]));
    expect(player.state.queue).toEqual([MUSIC_CATALOG[2]]);
    expect(player.state.currentTrack).toBe(MUSIC_CATALOG[2]);
    expect(adapter.setSource).toHaveBeenLastCalledWith(
      MUSIC_CATALOG[2].audioUrl,
    );

    act(() => {
      adapter.emit("error", { error: "decode failed" });
    });
    expect(player.state).toMatchObject({
      status: "error",
      error: "decode failed",
    });
    expect(adapter.pause).toHaveBeenCalledTimes(1);
    expect(adapter.setSource).toHaveBeenCalledTimes(2);
  });

  it("restarts a paused single-track queue without reloading or playing", async () => {
    render(
      <MusicPlayerProvider
        initialPreferences={{ selectedTrackIds: [MUSIC_CATALOG[0].id] }}
      >
        <Probe />
      </MusicPlayerProvider>,
    );
    await waitFor(() => expect(adapters).toHaveLength(1));
    const adapter = adapters[0];
    act(() => adapter.emit("canplay"));

    act(() => player.commands.next());
    expect(adapter.seek).toHaveBeenCalledWith(0);
    expect(adapter.setSource).toHaveBeenCalledTimes(1);
    expect(adapter.play).not.toHaveBeenCalled();
    expect(player.state.status).toBe("paused");
  });

  it("coalesces canplay attempts and converts a play rejection into recoverable state", async () => {
    render(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>,
    );
    await waitFor(() => expect(adapters).toHaveLength(1));
    const adapter = adapters[0];
    adapter.playError = new DOMException("Not allowed", "NotAllowedError");

    await act(async () => player.commands.play());
    await waitFor(() => expect(player.state.status).toBe("error"));
    expect(player.state.error).toContain("Not allowed");
    expect(adapter.play).toHaveBeenCalledTimes(1);

    adapter.playError = null;
    await act(async () => player.commands.play());
    act(() => {
      adapter.emit("canplay");
      adapter.emit("canplay");
    });
    expect(adapter.play).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(player.state.status).toBe("playing"));
  });

  it("keeps invalid selection non-destructive and restores the last non-zero volume", async () => {
    render(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>,
    );
    await waitFor(() => expect(adapters).toHaveLength(1));
    const adapter = adapters[0];

    act(() => {
      adapter.emit("canplay");
      player.commands.applySelection([]);
    });
    expect(player.state.queue).toHaveLength(3);
    expect(player.state.error).toMatch(/至少选择一首/u);

    act(() => {
      player.commands.setVolume(0.4);
      player.commands.toggleMute();
    });
    expect(adapter.setMuted).toHaveBeenLastCalledWith(true);
    expect(player.state.muted).toBe(true);

    act(() => player.commands.toggleMute());
    expect(adapter.setVolume).toHaveBeenLastCalledWith(0.4);
    expect(adapter.setMuted).toHaveBeenLastCalledWith(false);
    expect(player.state).toMatchObject({ volume: 0.4, muted: false });
  });

  it("removes every subscription during Strict Mode replay and unmount", async () => {
    const rendered = render(
      <StrictMode>
        <MusicPlayerProvider>
          <Probe />
        </MusicPlayerProvider>
      </StrictMode>,
    );
    await waitFor(() => expect(adapters.length).toBeGreaterThanOrEqual(2));
    expect(
      adapters.slice(0, -1).every((adapter) => adapter.listenerCount() === 0),
    ).toBe(true);
    expect(adapters.at(-1)?.listenerCount()).toBe(1);

    rendered.unmount();
    expect(adapters.every((adapter) => adapter.listenerCount() === 0)).toBe(
      true,
    );
  });
});
