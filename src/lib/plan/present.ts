// src/lib/plan/present.ts
//
// The providers offered here, for code the registry's own imports reach (the
// line-up store, read by the local provider): importing the registry from there
// would close a cycle, so the registry registers its reader here as it loads.
// A test that replaces the registry's `presentProviders` must also call
// `registerPresentProviders` with its replacement, or the store and the page
// see different lists. Nothing here imports the registry or a store.
import type { AnyProvider } from '../provider/types';

let read: (() => readonly AnyProvider[]) | null = null;

/** Called once by the registry with `presentProviders`; a test registers its own list. */
export function registerPresentProviders(reader: () => readonly AnyProvider[]): void {
  read = reader;
}

/** The providers offered here, read when asked. Throws while none is registered: an empty list would move stages. */
export function presentHosts(): readonly AnyProvider[] {
  if (!read) throw new Error('No provider list is registered: load the provider registry (or, in a test, register one) first.');
  return read();
}
