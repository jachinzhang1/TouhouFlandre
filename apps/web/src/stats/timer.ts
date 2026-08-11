"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export class ForegroundTimer {
  private elapsedMs: number;
  private active = false;
  private anchor: number | null = null;
  private readonly handleVisibility = () => this.sync();

  constructor(initialElapsedMs = 0) {
    this.elapsedMs = Math.max(0, initialElapsedMs);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.handleVisibility);
    }
  }

  private visible(): boolean {
    return typeof document === "undefined" || document.visibilityState === "visible";
  }

  private now(): number {
    return typeof performance === "undefined" ? Date.now() : performance.now();
  }

  private sync(): void {
    const shouldRun = this.active && this.visible();
    if (shouldRun && this.anchor === null) {
      this.anchor = this.now();
      return;
    }
    if (!shouldRun && this.anchor !== null) {
      this.elapsedMs += this.now() - this.anchor;
      this.anchor = null;
    }
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.snapshot();
    this.active = active;
    this.sync();
  }

  reset(initialElapsedMs = 0): void {
    this.anchor = null;
    this.elapsedMs = Math.max(0, initialElapsedMs);
    this.sync();
  }

  snapshot(): number {
    if (this.anchor === null) return Math.round(this.elapsedMs);
    const now = this.now();
    this.elapsedMs += now - this.anchor;
    this.anchor = now;
    return Math.round(this.elapsedMs);
  }

  destroy(): void {
    this.setActive(false);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.handleVisibility);
    }
  }
}

export function useForegroundTimer(key: string, active: boolean, initialElapsedMs = 0) {
  const timerRef = useRef<ForegroundTimer | null>(null);
  const [elapsedMs, setElapsedMs] = useState(initialElapsedMs);

  if (timerRef.current === null) timerRef.current = new ForegroundTimer(initialElapsedMs);

  useEffect(() => {
    const timer = timerRef.current;
    if (!timer) return;
    timer.reset(initialElapsedMs);
    setElapsedMs(initialElapsedMs);
  }, [key, initialElapsedMs]);

  useEffect(() => {
    const timer = timerRef.current;
    if (!timer) return;
    timer.setActive(active);
    setElapsedMs(timer.snapshot());
    if (!active) return;
    const interval = window.setInterval(() => setElapsedMs(timer.snapshot()), 250);
    return () => window.clearInterval(interval);
  }, [active, key]);

  useEffect(() => () => timerRef.current?.destroy(), []);

  const checkpoint = useCallback(() => {
    const value = timerRef.current?.snapshot() ?? 0;
    setElapsedMs(value);
    return value;
  }, []);

  return { elapsedMs, checkpoint };
}

export function useWallClockTimer(key: string, active: boolean, initialElapsedMs = 0) {
  const baseElapsedRef = useRef(initialElapsedMs);
  const anchorRef = useRef(Date.now());
  const activeRef = useRef(active);
  const [elapsedMs, setElapsedMs] = useState(initialElapsedMs);

  const snapshotValue = useCallback(() => {
    if (!activeRef.current) return Math.round(baseElapsedRef.current);
    return Math.round(baseElapsedRef.current + Date.now() - anchorRef.current);
  }, []);

  useEffect(() => {
    baseElapsedRef.current = Math.max(0, initialElapsedMs);
    anchorRef.current = Date.now();
    setElapsedMs(baseElapsedRef.current);
  }, [key, initialElapsedMs]);

  useEffect(() => {
    const wasActive = activeRef.current;
    if (wasActive && !active) {
      baseElapsedRef.current = snapshotValue();
    }
    if (!wasActive && active) {
      anchorRef.current = Date.now();
    }
    activeRef.current = active;
    setElapsedMs(snapshotValue());
    if (!active) return;
    const interval = window.setInterval(() => setElapsedMs(snapshotValue()), 250);
    return () => window.clearInterval(interval);
  }, [active, key, snapshotValue]);

  const checkpoint = useCallback(() => {
    const value = snapshotValue();
    setElapsedMs(value);
    return value;
  }, [snapshotValue]);

  return { elapsedMs, checkpoint };
}

