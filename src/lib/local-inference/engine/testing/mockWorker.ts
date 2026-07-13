import { vi } from 'vitest';

/** A drop-in stand-in for the DOM Worker, capturing postMessage and letting
 *  tests drive onmessage/onerror. Used by WorkerSession unit tests (via
 *  `makeWorker: () => new MockWorker(...)`) and by engine characterization
 *  tests (via `installMockWorker()`, which patches globalThis.Worker). */
export class MockWorker {
  static instances: MockWorker[] = [];
  postMessage = vi.fn();
  terminate = vi.fn();
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  addEventListener = vi.fn();
  removeEventListener = vi.fn();

  constructor(public url: string | URL, public opts?: WorkerOptions) {
    MockWorker.instances.push(this);
  }

  /** Simulate a message from the worker to the main thread. */
  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  /** Simulate a worker-level error event. */
  emitError(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }

  static last(): MockWorker {
    return MockWorker.instances[MockWorker.instances.length - 1];
  }

  static reset(): void {
    MockWorker.instances = [];
  }
}

/** Patch globalThis.Worker with MockWorker. Returns a restore function. */
export function installMockWorker(): () => void {
  const original = (globalThis as any).Worker;
  MockWorker.reset();
  (globalThis as any).Worker = MockWorker;
  return () => { (globalThis as any).Worker = original; };
}
