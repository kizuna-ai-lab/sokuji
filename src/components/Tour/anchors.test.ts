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
for (const file of walk(join(process.cwd(), 'src/components'))) {
  for (const m of readFileSync(file, 'utf8').matchAll(/data-tour="([a-z-]+)"/g)) declared.add(m[1]);
}

describe('tour anchors', () => {
  it.each(BASICS_STEPS.filter((s) => s.anchor).map((s) => [s.id, s.anchor!]))('%s → data-tour="%s" exists in src/components', (_id, anchor) => {
    expect(declared.has(anchor)).toBe(true);
  });

  it('main-action is declared in both footers (basic and advanced)', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/MainPanel/MainPanel.tsx'), 'utf8');
    expect(src.match(/data-tour="main-action"/g)?.length).toBe(2);
  });
});
