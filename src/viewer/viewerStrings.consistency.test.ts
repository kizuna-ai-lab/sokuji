// src/viewer/viewerStrings.consistency.test.ts
/**
 * The viewer's words, both ways: every `viewer.*` key the page's code names
 * exists in `en`, and every `en` `viewer.*` key is named somewhere. Keys are
 * found as string literals ('viewer.x.y'), which is why the code never
 * builds a key from a template.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import en from '../locales/en/translation.json';

const DIR = __dirname;
const sources = readdirSync(DIR)
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => readFileSync(join(DIR, f), 'utf8'));

const flatten = (node: unknown, prefix: string): string[] =>
  typeof node === 'string' ? [prefix] : Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => flatten(v, `${prefix}.${k}`));

describe('viewer strings in use', () => {
  const used = new Set(sources.flatMap((s) => [...s.matchAll(/['"`](viewer\.[A-Za-z0-9_.]+)['"`]/g)].map((m) => m[1])));
  const defined = new Set(flatten((en as Record<string, unknown>).viewer, 'viewer'));

  it('every key the page names exists in en', () => {
    expect([...used].filter((k) => !defined.has(k))).toEqual([]);
  });

  it('every en key is named by the page', () => {
    expect([...defined].filter((k) => !used.has(k))).toEqual([]);
  });

  it('nothing under src/viewer imports analytics or PostHog', () => {
    for (const s of sources) expect(s).not.toMatch(/analytics|posthog/i);
  });
});
