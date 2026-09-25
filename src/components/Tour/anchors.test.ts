import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BASICS_STEPS } from './steps';

// Every anchor the catalogue names must exist as data-tour="…" in a component.
// A file scan rather than a render: the anchors live in eight components with
// eight different mock surfaces, and the property we want is "the string is in
// the source", which is what a scan measures exactly.
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx') && !p.endsWith('.test.tsx')) out.push(p);
  }
  return out;
}

const declared = new Set<string>();
// Walks src/providers too: LocalInferenceEngineSummary's engine-chips anchor
// lives there (1e-3b-2 Task 2), not under src/components.
for (const file of [
  ...walk(join(process.cwd(), 'src/components')),
  ...walk(join(process.cwd(), 'src/providers')),
]) {
  for (const m of readFileSync(file, 'utf8').matchAll(/data-tour="([a-z-]+)"/g)) declared.add(m[1]);
}

describe('tour anchors', () => {
  it.each(BASICS_STEPS.filter((s) => s.anchor).map((s) => [s.id, s.anchor!]))('%s → data-tour="%s" exists in src/components', (_id, anchor) => {
    expect(declared.has(anchor)).toBe(true);
  });

  // Where each anchor renders is a rendered test's now, not a count here:
  // `main-action` in both footers (panel/PanelFooter.test.tsx), `engine-chips`
  // in LocalInference's summary (LocalInferenceEngineSummary.test.tsx).
});
