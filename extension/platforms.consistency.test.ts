import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { PLATFORM_HOSTNAMES, PLATFORMS, deriveContentScripts } from './platforms';
import manifest from './manifest.json';

describe('every platform is reachable through the manifest', () => {
  it('each registry hostname appears in some content_scripts matches entry', () => {
    const manifestHosts = new Set(
      manifest.content_scripts.flatMap((e: any) => e.matches.map((m: string) => new URL(m.replace('/*', '/')).hostname)),
    );
    for (const host of PLATFORM_HOSTNAMES) expect(manifestHosts.has(host), host).toBe(true);
  });

  it('deriveContentScripts includes platforms.generated.js before content.js', () => {
    for (const e of deriveContentScripts()) {
      if (e.js.includes('content.js')) {
        expect(e.js.indexOf('platforms.generated.js')).toBeLessThan(e.js.indexOf('content.js'));
      }
    }
  });
});

// site-plugins.js runs in the page's MAIN world (needed to see page globals
// like the video-conferencing app's own JS), so it cannot see the isolated
// world's `globalThis.SOKUJI_PLATFORMS` and cannot import platforms.ts either
// (it's a vanilla script, not a module). It therefore keeps its own inline
// `HOST_TO_PLUGIN_KEY` map — the one surface that architecturally can't
// consume the generated table. This test parses that map out of the file as
// text and diffs it against the registry so the two can't silently drift.
describe('site-plugins.js HOST_TO_PLUGIN_KEY stays in sync with the registry', () => {
  function extractHostToPluginKey(): Record<string, string> {
    const source = readFileSync(join(__dirname, 'content', 'site-plugins.js'), 'utf-8');
    const start = source.indexOf('const HOST_TO_PLUGIN_KEY = {');
    if (start === -1) throw new Error('HOST_TO_PLUGIN_KEY declaration not found in site-plugins.js');
    const braceStart = source.indexOf('{', start);
    const braceEnd = source.indexOf('};', braceStart);
    if (braceEnd === -1) throw new Error('closing "};" for HOST_TO_PLUGIN_KEY not found in site-plugins.js');
    const body = source.slice(braceStart + 1, braceEnd);

    const entries: Record<string, string> = {};
    // Each non-blank line is `'hostname': 'pluginKey'` (optionally trailing comma).
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      const match = line.match(/^'([^']+)':\s*'([^']+)',?$/);
      if (!match) throw new Error(`unparsable HOST_TO_PLUGIN_KEY line in site-plugins.js: ${JSON.stringify(rawLine)}`);
      const [, host, pluginKey] = match;
      entries[host] = pluginKey;
    }
    return entries;
  }

  it('exactly matches the registry host -> pluginKey derivation', () => {
    const fromFile = extractHostToPluginKey();
    const fromRegistry = Object.fromEntries(
      PLATFORMS.filter(p => p.pluginKey).map(p => [p.hostname, p.pluginKey as string]),
    );
    expect(fromFile).toEqual(fromRegistry);
  });
});
