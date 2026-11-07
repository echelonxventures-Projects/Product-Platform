/**
 * Temporal context source (UCI-007). The platform never reads the wall clock
 * directly: it asks the Clock, so simulations and tests can run in a
 * controlled ordering without a parallel code path (Phase 007 §5.9).
 */
export interface Clock {
  now(): string;
}

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

export class ManualClock implements Clock {
  private current: number;
  constructor(start: string) {
    this.current = Date.parse(start);
  }
  now(): string {
    return new Date(this.current).toISOString();
  }
  advance(ms: number): void {
    this.current += ms;
  }
  set(instant: string): void {
    this.current = Date.parse(instant);
  }
}

/** Half-open interval [start, end) — the declared convention of V-TM-02. */
export interface Interval {
  start: string;
  end: string | null;
}

export function contains(interval: Interval, instant: string): boolean {
  const t = Date.parse(instant);
  return Date.parse(interval.start) <= t && (interval.end === null || t < Date.parse(interval.end));
}

export function intersect(a: Interval, b: Interval): Interval | null {
  const start = Math.max(Date.parse(a.start), Date.parse(b.start));
  const endA = a.end === null ? Infinity : Date.parse(a.end);
  const endB = b.end === null ? Infinity : Date.parse(b.end);
  const end = Math.min(endA, endB);
  if (end <= start) return null;
  return { start: new Date(start).toISOString(), end: end === Infinity ? null : new Date(end).toISOString() };
}

export function overlaps(a: Interval, b: Interval): boolean {
  return intersect(a, b) !== null;
}
