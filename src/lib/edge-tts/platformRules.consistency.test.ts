// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'module';
import { describe, it, expect } from 'vitest';
import { SYNTHESIS_ENDPOINTS } from './edgeTts';

// A browser cannot set an upgrade's User-Agent, and every synthesis host answers
// 403 without Edge's. Electron and the extension inject it per host, so each
// host EdgeTtsConnection may try must be covered on both platforms, and the
// extension may only rewrite headers on hosts its manifest grants.

const root = join(__dirname, '..', '..', '..');
const background = readFileSync(join(root, 'extension', 'background', 'background.js'), 'utf8');
const manifest = JSON.parse(readFileSync(join(root, 'extension', 'manifest.json'), 'utf8'));
const hosts = SYNTHESIS_ENDPOINTS.map((e) => e.host);

/** A function's source in background.js, to its closing brace at the start of a line. */
function fn(name: string): string {
  const start = background.indexOf(`function ${name}(`);
  expect(start, `expected to find function ${name}`).toBeGreaterThan(-1);
  const rest = background.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2);
}

describe('Edge TTS: every synthesis host gets the User-Agent on every platform', () => {
  it("the extension's background installs one DNR rule per synthesis host, inside the Edge TTS id range", () => {
    const list = /const EDGE_TTS_WS_HOSTS = \[([^\]]*)\];/.exec(background);
    expect(list, 'EDGE_TTS_WS_HOSTS in background.js').not.toBeNull();
    expect([...list![1].matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual(hosts);
    expect(hosts.length).toBeLessThanOrEqual(10);

    const set = fn('edgeTtsSetDNRHeaders');
    expect(set).toContain('EDGE_TTS_WS_HOSTS.map((host, i) => ({');
    expect(set).toContain('id: EDGE_TTS_DNR_RULE_ID_BASE + i,');
    expect(set).toContain('urlFilter: `||${host}`,');
    expect(set).toContain("resourceTypes: ['websocket'],");
  });

  it('the extension manifest grants each synthesis host over wss, in host_permissions and in connect-src', () => {
    const origins: string[] = manifest.content_security_policy.extension_pages.split(/[ ;]+/);
    for (const host of hosts) {
      expect(manifest.host_permissions, host).toContain(`wss://${host}/*`);
      expect(origins, host).toContain(`wss://${host}`);
    }
  });

  it('the extension manifest still grants the voice list on speech.platform.bing.com over https', () => {
    const origins: string[] = manifest.content_security_policy.extension_pages.split(/[ ;]+/);
    expect(manifest.host_permissions).toContain('https://speech.platform.bing.com/*');
    expect(origins).toContain('https://speech.platform.bing.com');
  });

  it("Electron's upgrade header rules apply on every synthesis host (no allow-list)", () => {
    const { createWsHeaderRules } = createRequire(import.meta.url)(join(root, 'electron', 'ws-header-rules.js'));
    const rules = createWsHeaderRules();
    for (const endpoint of SYNTHESIS_ENDPOINTS) {
      expect(rules.set({ host: endpoint.host, headers: { 'User-Agent': 'Edg/143' } })).toEqual({ success: true });
      const headers: Record<string, string> = {};
      expect(rules.take(`${endpoint.url}?ConnectionId=x`, headers), endpoint.host).toBe(true);
      expect(headers['User-Agent']).toBe('Edg/143');
    }
  });
});
