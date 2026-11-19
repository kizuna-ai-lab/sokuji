// src/lib/plan/testing.ts
//
// Fixtures for tests: stub providers, plans built straight from a provider
// definition, and a run's shape over one. Imported by tests only.
import { CAPS } from '../lineup/catalog';
import type { AnyProvider } from '../provider/types';
import type { RunShape } from '../session/types';
import type { ComposeInput } from './compose';
import { wholePlan } from './wholeUnit';

/** A provider definition with only what its whole-provider unit reads, so the real registry stays out of the tests. */
export const stubProvider = (id: string, over: Record<string, unknown> = {}): AnyProvider => ({
  id,
  speech: 'optional',
  turns: () => ['auto'],
  boundaries: () => 'silence',
  textInput: () => false,
  build: () => ({}),
  describe: () => ({}),
  start: () => undefined,
  ...over,
}) as unknown as AnyProvider;

/** A composer input that offers a stub provider for every host in the catalog, so every option is offered; `over` goes to each stub. */
export function stubHosts(over: Record<string, unknown> = {}): ComposeInput {
  return { providers: [...new Set(CAPS.map((c) => c.host))].map((id) => stubProvider(id, over)), settings: () => undefined };
}

/** The plan of a line-up that names `p` on every stage, built without the catalog (a test's stub provider is not in it). */
export { wholePlan as planOf } from './wholeUnit';

/**
 * A run's shape on `p` alone: its plan, and its account from `settings` (absent: undefined) and `credentials`
 * (absent: none saved), beside the rest of the shape as given.
 */
export function shapeWith(
  p: AnyProvider,
  rest: Omit<RunShape, 'plan' | 'accounts'> & { settings?: unknown; credentials?: Record<string, string> },
): RunShape {
  const { settings, credentials = {}, ...shape } = rest;
  return { ...shape, plan: wholePlan(p), accounts: { [p.id]: { settings, credentials } } };
}
