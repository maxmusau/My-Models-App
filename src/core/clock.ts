/** Time source in whole seconds. Injectable so auctions can be tested without waiting. */
export class Clock {
  private fixed: number | null = null;
  private offset = 0;

  now(): number {
    return this.fixed ?? Math.floor(Date.now() / 1000) + this.offset;
  }

  /** Pin time to an exact value (used by tests and by replaying a stored history). */
  set(t: number): void {
    this.fixed = t;
  }

  /** Move time forward. Only meaningful on a pinned clock or as an offset from real time. */
  advance(seconds: number): void {
    if (this.fixed !== null) this.fixed += seconds;
    else this.offset += seconds;
  }

  /** Return to real time (plus any offset). */
  release(): void {
    this.fixed = null;
  }
}
