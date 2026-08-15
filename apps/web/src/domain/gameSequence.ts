import type {
  Envelope,
  GameSequenceFrame,
  RoomCursorEnvelope,
} from "@touhouflandre/shared";

export interface GameSequenceHandlers {
  applyEvent: (event: Envelope) => void;
  advance: (sequence: number) => void;
  persist?: (sequence: number) => void;
  resync: (after: number) => Promise<number>;
  onResyncError?: (error: unknown) => void;
}

/**
 * Serializes v2 game frames for one connection. Duplicates are ignored, cursor
 * frames only advance the watermark, and all frames received during one true
 * gap share a single snapshot request.
 */
export class GameSequenceCoordinator {
  private applied: number;
  private completed: number;
  private live = false;
  private readonly buffered = new Map<number, GameSequenceFrame>();
  private resyncInFlight: Promise<void> | null = null;

  constructor(
    initialSequence: number,
    private readonly handlers: GameSequenceHandlers,
    completedSequence = initialSequence,
  ) {
    this.applied = initialSequence;
    this.completed = completedSequence;
  }

  get appliedSequence(): number {
    return this.applied;
  }

  get completedSequence(): number {
    return this.completed;
  }

  receive(frame: GameSequenceFrame): void {
    if (frame.sequence <= this.applied) return;
    if (this.resyncInFlight || frame.sequence > this.applied + 1) {
      this.buffered.set(frame.sequence, frame);
      this.startResyncIfNeeded();
      return;
    }
    this.applyContinuous(frame);
    this.drainContinuous();
  }

  align(sequence: number): void {
    if (sequence > this.applied) {
      this.applied = sequence;
      this.handlers.advance(sequence);
    }
    for (const bufferedSequence of this.buffered.keys()) {
      if (bufferedSequence <= this.applied)
        this.buffered.delete(bufferedSequence);
    }
    this.drainContinuous();
  }

  complete(sequence: number): void {
    this.align(sequence);
    this.completed = this.applied;
    this.live = true;
    this.handlers.persist?.(this.completed);
  }

  async waitForIdle(): Promise<void> {
    await this.resyncInFlight;
  }

  private applyContinuous(frame: GameSequenceFrame): void {
    if (!isRoomCursor(frame)) this.handlers.applyEvent(frame);
    this.applied = frame.sequence;
    this.handlers.advance(frame.sequence);
    if (this.live) {
      this.completed = frame.sequence;
      this.handlers.persist?.(frame.sequence);
    }
  }

  private drainContinuous(): void {
    while (!this.resyncInFlight) {
      const next = this.buffered.get(this.applied + 1);
      if (!next) break;
      this.buffered.delete(next.sequence);
      this.applyContinuous(next);
    }
  }

  private startResyncIfNeeded(): void {
    if (this.resyncInFlight) return;
    const firstBuffered = Math.min(...this.buffered.keys());
    if (!Number.isFinite(firstBuffered) || firstBuffered <= this.applied + 1) {
      this.drainContinuous();
      return;
    }
    this.resyncInFlight = this.handlers
      .resync(this.applied)
      .then((sequence) => this.align(sequence))
      .catch((error: unknown) => this.handlers.onResyncError?.(error))
      .finally(() => {
        this.resyncInFlight = null;
        this.drainContinuous();
      });
  }
}

export function isRoomCursor(
  frame: GameSequenceFrame,
): frame is RoomCursorEnvelope {
  return frame.type === "room.cursor";
}
