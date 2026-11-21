// src/stores/lineUpStore.testing.ts
//
// Fixtures for tests: what runs, set straight on the stores. Imported by tests only.
import { useLineUpStore } from './lineUpStore';

/**
 * The provider that runs while no line-up is stored: the state a launch leaves until its line-up is written, and
 * the only one that can name a provider the catalog does not hold (a test's stub). Null: nothing has loaded yet.
 * A line-up the test stored stays, and decides what runs.
 */
export function runsOn(id: string | null): void {
  useLineUpStore.setState({ unstoredProvider: id });
}
