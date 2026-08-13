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
  it("advances cursor frames without applying a business event", () => {
    const applyEvent = vi.fn();
    const advance = vi.fn();
    const coordinator = new GameSequenceCoordinator(0, {
      applyEvent,
      advance,
      resync: vi.fn(),
    });

    coordinator.receive(cursor(1));

    expect(applyEvent).not.toHaveBeenCalled();
    expect(advance).toHaveBeenCalledWith(1);
    expect(coordinator.appliedSequence).toBe(1);
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
});
