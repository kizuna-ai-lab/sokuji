import { describe, it, expect } from 'vitest';
import manifest from './manifest.json';
import { deriveContentScripts, deriveSubtitleWebAccessibleMatches } from './platforms';

describe('manifest stays consistent with the platform registry', () => {
  it('content_scripts match the registry (grouped by content profile)', () => {
    // Compare as sets-of-(matches,js,run_at,all_frames) so ordering is irrelevant.
    const norm = (arr: any[]) => arr
      .map(e => JSON.stringify({ matches: [...e.matches].sort(), js: e.js, run_at: e.run_at ?? null, all_frames: e.all_frames ?? false }))
      .sort();
    expect(norm(manifest.content_scripts)).toEqual(norm(deriveContentScripts()));
  });

  it('subtitle web-accessible matches = every platform host', () => {
    const war = manifest.web_accessible_resources.find((w: any) =>
      w.resources.includes('subtitle-overlay.js'));
    expect([...war!.matches].sort()).toEqual(deriveSubtitleWebAccessibleMatches().sort());
  });
});
