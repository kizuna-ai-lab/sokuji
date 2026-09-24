import type { Clock } from '../contract/clock';
import { describeCause } from '../diagnostics/describeCause';

/** A release that threw, rejected or overran its timeout. */
export interface ReleaseFailure {
  name: string;
  message: string;
}

interface Entry {
  name: string;
  release: () => Promise<void> | void;
}

/**
 * Every resource a run acquires, pushed with its release the moment it is
 * acquired (spec: "A run"). Stop, failure and cancel all unwind it the same
 * way: last in first out, one release at a time, each bounded by a timeout,
 * once. It replaces today's five hand-written rollback lists.
 */
export class ResourceStack {
  private readonly entries: Entry[] = [];
  private unwinding: Promise<void> | null = null;

  constructor(
    private readonly clock: Clock,
    private readonly timeoutMs: number,
    private readonly onFailure: (failure: ReleaseFailure) => void,
  ) {}

  get unwound(): boolean {
    return this.unwinding !== null;
  }

  /**
   * Pushes a release. Once unwinding has begun the release runs at once
   * instead: a resource that finished opening after a cancel is closed, never
   * kept.
   */
  defer(name: string, release: () => Promise<void> | void): void {
    if (this.unwinding) {
      void this.release({ name, release });
      return;
    }
    this.entries.push({ name, release });
  }

  /** Releases everything, last pushed first. Every call returns the same promise. */
  unwind(): Promise<void> {
    this.unwinding ??= this.run();
    return this.unwinding;
  }

  /**
   * `pagehide`: fires every remaining release now, last pushed first, without
   * awaiting any — a release that awaits the network must not hold back the
   * ones below it. The stack counts as unwound: a later `defer` runs at once.
   */
  abandon(): void {
    this.unwinding ??= Promise.resolve();
    for (let entry = this.entries.pop(); entry; entry = this.entries.pop()) void this.release(entry);
  }

  private async run(): Promise<void> {
    for (let entry = this.entries.pop(); entry; entry = this.entries.pop()) {
      await this.release(entry);
    }
  }

  private release(entry: Entry): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = (failure: ReleaseFailure | null) => {
        if (settled) return;
        settled = true;
        cancel();
        if (failure) this.onFailure(failure);
        resolve();
      };
      const cancel = this.clock.setTimeout(
        () => finish({ name: entry.name, message: `timed out after ${this.timeoutMs} ms` }),
        this.timeoutMs,
      );
      Promise.resolve()
        .then(entry.release)
        .then(
          () => finish(null),
          (error) => finish({ name: entry.name, message: describeCause(error) }),
        );
    });
  }
}
