import { describe, expect, it, vi } from "vitest";
import type { Envelope, RoomCursorEnvelope } from "@touhouflandre/shared";
import { GameSequenceCoordinator } from "./gameSequence";

function event(sequence: number): Envelope {
  return {
    type: "room.updated",
    eventId: `event-${sequence}`,
    roomId: "room-1",
    sequence,
    occurredAt: "2026-08-13T00:00:00Z",
    payload: {},
  };
}

function cursor(sequence: number): RoomCursorEnvelope {
  return {
    type: "room.cursor",
    eventId: `event-${sequence}`,
    roomId: "room-1",
    sequence,
    occurredAt: "2026-08-13T00:00:00Z",
  };
}

describe("GameSequenceCoordinator", () => {
  it("applies business events while cursor frames only advance the watermark", () => {
    const applyEvent = vi.fn();
    const advance = vi.fn();
    const coordinator = new GameSequenceCoordinator(0, {
      applyEvent,
      advance,
      resync: vi.fn(),
    });

    coordinator.receive(event(1));
    coordinator.receive(cursor(2));

    expect(applyEvent).toHaveBeenCalledOnce();
    expect(applyEvent).toHaveBeenCalledWith(event(1));
    expect(advance.mock.calls).toEqual([[1], [2]]);
    expect(coordinator.appliedSequence).toBe(2);
  });

  it("uses one snapshot for a true gap and applies buffered duplicates once", async () => {
    let finishResync: ((sequence: number) => void) | undefined;
    const resync = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          finishResync = resolve;
        }),
    );
    const applyEvent = vi.fn();
    const coordinator = new GameSequenceCoordinator(0, {
      applyEvent,
      advance: vi.fn(),
      resync,
    });

    coordinator.receive(event(3));
    coordinator.receive(event(3));
    coordinator.receive(cursor(4));
    expect(resync).toHaveBeenCalledTimes(1);
    expect(resync).toHaveBeenCalledWith(0);

    finishResync?.(2);
    await coordinator.waitForIdle();

    expect(applyEvent).toHaveBeenCalledTimes(1);
    expect(applyEvent).toHaveBeenCalledWith(event(3));
    expect(coordinator.appliedSequence).toBe(4);
  });

  it("does not persist replay progress before sync.complete", () => {
    const persist = vi.fn();
    const applyEvent = vi.fn();
    const coordinator = new GameSequenceCoordinator(0, {
      applyEvent,
      advance: vi.fn(),
      persist,
      resync: vi.fn(),
    });

    coordinator.receive(event(1));
    coordinator.receive(cursor(2));
    expect(coordinator.appliedSequence).toBe(2);
    expect(coordinator.completedSequence).toBe(0);
    expect(persist).not.toHaveBeenCalled();

    coordinator.complete(2);
    expect(coordinator.completedSequence).toBe(2);
    expect(persist).toHaveBeenLastCalledWith(2);

    coordinator.receive(event(3));
    coordinator.receive(event(3));
    expect(coordinator.completedSequence).toBe(3);
    expect(persist).toHaveBeenLastCalledWith(3);
    expect(persist).toHaveBeenCalledTimes(2);
    expect(applyEvent.mock.calls).toEqual([[event(1)], [event(3)]]);
  });
});
