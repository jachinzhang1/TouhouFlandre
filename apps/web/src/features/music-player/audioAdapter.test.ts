import { describe, expect, it, vi } from "vitest";
import {
  createHtmlAudioAdapter,
  MUSIC_AUDIO_EVENT_TYPES,
  type MusicAudioEvent,
} from "./audioAdapter";

function createFakeAudio() {
  const listeners = new Map<string, Set<EventListener>>();
  const audio = {
    currentTime: 0,
    duration: 120,
    error: null,
    muted: false,
    preload: "",
    src: "",
    volume: 0.7,
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      const entries = listeners.get(type) ?? new Set<EventListener>();
      entries.add(listener);
      listeners.set(type, entries);
    }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => {
      listeners.get(type)?.delete(listener);
    }),
    removeAttribute: vi.fn((name: string) => {
      if (name === "src") audio.src = "";
    }),
    load: vi.fn(),
    play: vi.fn(async () => undefined),
    pause: vi.fn(),
    emit(type: string) {
      for (const listener of listeners.get(type) ?? []) {
        listener(new Event(type));
      }
    },
  } as unknown as HTMLAudioElement & { emit(type: string): void };

  return audio;
}

describe("createHtmlAudioAdapter", () => {
  it("configures metadata preload and emits source-tagged media events", () => {
    const audio = createFakeAudio();
    const adapter = createHtmlAudioAdapter(audio);
    const events: MusicAudioEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    expect(audio.preload).toBe("metadata");
    const firstToken = adapter.setSource("/music/first.mp3");
    audio.emit("loadedmetadata");

    expect(firstToken).toBe(1);
    expect(audio.src).toBe("/music/first.mp3");
    expect(audio.load).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toMatchObject({
      type: "loadedmetadata",
      sourceToken: firstToken,
      duration: 120,
    });

    adapter.setSource(null);
    expect(audio.removeAttribute).toHaveBeenCalledWith("src");
    expect(audio.src).toBe("");
  });

  it("removes old source listeners before binding the next source", () => {
    const audio = createFakeAudio();
    const adapter = createHtmlAudioAdapter(audio);
    const events: MusicAudioEvent[] = [];
    const unsubscribe = adapter.subscribe((event) => events.push(event));

    adapter.setSource("/music/first.mp3");
    adapter.setSource("/music/second.mp3");
    audio.emit("error");

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error", sourceToken: 2 });
    expect(audio.removeEventListener).toHaveBeenCalled();

    unsubscribe();
    audio.emit("ended");
    expect(events).toHaveLength(1);
  });

  it("clears playback intent when play rejects and restores it on pause", async () => {
    const audio = createFakeAudio();
    audio.play = vi.fn(async () => {
      throw new DOMException("Not allowed", "NotAllowedError");
    });
    const adapter = createHtmlAudioAdapter(audio);

    await expect(adapter.play()).rejects.toThrow("Not allowed");
    expect(adapter.getPlaybackIntent()).toBe("paused");

    audio.play = vi.fn(async () => undefined);
    await adapter.play();
    expect(adapter.getPlaybackIntent()).toBe("playing");
    adapter.pause();
    expect(adapter.getPlaybackIntent()).toBe("paused");
  });

  it("clamps seek and volume commands to media-safe values", () => {
    const audio = createFakeAudio();
    const adapter = createHtmlAudioAdapter(audio);

    adapter.seek(999);
    expect(audio.currentTime).toBe(120);
    adapter.seek(-10);
    expect(audio.currentTime).toBe(0);
    adapter.setVolume(4);
    expect(audio.volume).toBe(1);
    expect(audio.muted).toBe(false);
    adapter.setVolume(-1);
    expect(audio.volume).toBe(0);
  });

  it("registers the complete media event surface", () => {
    const audio = createFakeAudio();
    const adapter = createHtmlAudioAdapter(audio);
    const unsubscribe = adapter.subscribe(() => undefined);
    const addEventListenerMock =
      audio.addEventListener as unknown as ReturnType<typeof vi.fn>;

    expect(
      addEventListenerMock.mock.calls.map((args: unknown[]) => args[0]),
    ).toEqual(expect.arrayContaining([...MUSIC_AUDIO_EVENT_TYPES]));
    unsubscribe();
    expect(audio.removeEventListener).toHaveBeenCalledTimes(
      MUSIC_AUDIO_EVENT_TYPES.length,
    );
  });
});
