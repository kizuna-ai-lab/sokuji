// electron/ws-header-rules.test.js
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const { createWsHeaderRules } = nodeRequire('./ws-header-rules.js');

/** An upgrade's headers as Chromium hands them over: its own Origin and User-Agent among them. */
const upgrade = () => ({ Origin: 'file://', 'User-Agent': 'Chrome', 'Sec-WebSocket-Version': '13' });
const LIVE = { host: 'api.openai.com', path: '/v1/live/', headers: { Authorization: 'Bearer sk-live' }, removeHeaders: ['Origin'] };

describe('the WebSocket upgrade header rules (Stage 2 OpenAI Live, ruling 7; choice 2)', () => {
  it("a host-wide rule — Edge TTS's, the old AST2 client's — applies to any path on its host, once, as every rule did before", () => {
    const rules = createWsHeaderRules();
    expect(rules.set({ host: 'speech.platform.bing.com', headers: { 'User-Agent': 'Edg/143' } })).toEqual({ success: true });
    const h = upgrade();
    expect(rules.take('wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?X=1', h)).toBe(true);
    expect(h['User-Agent']).toBe('Edg/143');
    expect(h.Origin).toBe('file://');
    // One-shot: the next upgrade takes nothing.
    const again = upgrade();
    expect(rules.take('wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1', again)).toBe(false);
    expect(again).toEqual(upgrade());
  });

  it("a rule with a path applies only under it: OpenAI Live's never reaches OpenAI Realtime's or Translate's upgrade on the same host", () => {
    const rules = createWsHeaderRules();
    rules.set(LIVE);
    for (const url of ['wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1', 'wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate', 'wss://api.openai.com/v1/live']) {
      const h = upgrade();
      expect(rules.take(url, h), url).toBe(false);
      expect(h).toEqual(upgrade());
    }
    const h = upgrade();
    expect(rules.take('wss://api.openai.com/v1/live/sessions', h)).toBe(true);
    expect(h).toEqual({ 'User-Agent': 'Chrome', 'Sec-WebSocket-Version': '13', Authorization: 'Bearer sk-live' });
    expect(rules.size).toBe(0);
  });

  it('the longest path wins, and a host-wide rule stays for the next upgrade it matches', () => {
    const rules = createWsHeaderRules();
    rules.set({ host: 'api.openai.com', headers: { 'X-Host': 'wide' } });
    rules.set(LIVE);
    const live = upgrade();
    rules.take('wss://api.openai.com/v1/live/sessions', live);
    expect(live).toMatchObject({ Authorization: 'Bearer sk-live' });
    expect(live).not.toHaveProperty('X-Host');
    const other = upgrade();
    rules.take('wss://api.openai.com/v1/realtime', other);
    expect(other).toMatchObject({ 'X-Host': 'wide' });
  });

  it('removes a listed header whatever its case, coerces values to strings, and drops null or empty ones', () => {
    const rules = createWsHeaderRules();
    rules.set({ host: 'h.example', headers: { 'X-App-Id': 1714584595, 'X-Empty': '', 'X-Null': null }, removeHeaders: [' ORIGIN ', '', 7] });
    const h = { origin: 'x', Other: 'y' };
    rules.take('wss://h.example/ws', h);
    expect(h).toEqual({ Other: 'y', 'X-App-Id': '1714584595' });
  });

  it('refuses a rule with no host, no headers, or a path that is not one', () => {
    const rules = createWsHeaderRules();
    expect(rules.set({ headers: {} })).toEqual({ success: false, error: 'Invalid arguments: host and headers required' });
    expect(rules.set({ host: 'h.example' })).toEqual({ success: false, error: 'Invalid arguments: host and headers required' });
    expect(rules.set({ host: 'h.example', path: 'v1', headers: {} })).toEqual({ success: false, error: 'Invalid arguments: path must start with /' });
    expect(rules.set(undefined)).toMatchObject({ success: false });
    expect(rules.size).toBe(0);
  });

  it('clears by host and path; a clear with no path clears the host-wide rule alone; a second set replaces the first', () => {
    const rules = createWsHeaderRules();
    rules.set({ host: 'api.openai.com', headers: { 'X-Host': 'wide' } });
    rules.set(LIVE);
    rules.set({ ...LIVE, headers: { Authorization: 'Bearer sk-newer' } });
    expect(rules.size).toBe(2);
    expect(rules.clear({ host: 'api.openai.com' })).toEqual({ success: true });
    const h = upgrade();
    rules.take('wss://api.openai.com/v1/live/sessions', h);
    expect(h.Authorization).toBe('Bearer sk-newer');
    rules.set(LIVE);
    rules.clear({ host: 'api.openai.com', path: '/v1/live/' });
    expect(rules.size).toBe(0);
    expect(rules.clear({})).toEqual({ success: false, error: 'Invalid arguments: host required' });
  });

  it('leaves an upgrade to another host, or to a URL it cannot read, as it was', () => {
    const rules = createWsHeaderRules();
    rules.set(LIVE);
    const h = upgrade();
    expect(rules.take('wss://api.openai.com.evil.example/v1/live/sessions', h)).toBe(false);
    expect(rules.take('not a url', h)).toBe(false);
    expect(h).toEqual(upgrade());
    expect(rules.size).toBe(1);
  });
});
