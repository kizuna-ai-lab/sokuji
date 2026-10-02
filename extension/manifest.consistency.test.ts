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

  it('CSP connect-src allows the Soniox TTS REST host', () => {
    // Without this the preview call is blocked in the extension while working
    // fine in Electron — a silent, platform-specific failure that local
    // development never surfaces.
    const csp = (manifest as any).content_security_policy.extension_pages;
    expect(csp).toContain('https://tts-rt.soniox.com');
  });

  it("CSP connect-src allows Doubao's voice-sample CDN (the AST 2.0 voice preview)", () => {
    const origins = manifest.content_security_policy.extension_pages.split(/[ ;]+/);
    expect(origins).toContain('https://lf3-static.bytednsdoc.com');
  });

  it("CSP connect-src allows OpenAI's voice-sample CDN (the Realtime and Live voice preview)", () => {
    const origins = manifest.content_security_policy.extension_pages.split(/[ ;]+/);
    expect(origins).toContain('https://cdn.openai.com');
  });

  // The OpenAI Compatible presets were never reached from the extension (that
  // provider is Electron only) and the relay's sockets went with the relay
  // twins (Stage 2 deletion, rulings 2 and 5). The https origins of the
  // backend stay: the account and wallet calls use them.
  it('allows no origin only a deleted provider connected to', () => {
    const origins = manifest.content_security_policy.extension_pages.split(/[ ;]+/);
    for (const origin of [
      'https://api.cometapi.com', 'wss://api.cometapi.com',
      'https://new.yunai.link', 'wss://new.yunai.link',
      'wss://sokuji.kizuna.ai', 'wss://sokuji-api.kizuna.ai', 'wss://sokuji-api-dev.kizuna.ai',
    ]) {
      expect(origins, origin).not.toContain(origin);
    }
    expect(origins).toContain('https://sokuji-api.kizuna.ai');
  });

  it('allows every Soniox regional origin', () => {
    const csp = manifest.content_security_policy.extension_pages;
    for (const origin of [
      'https://api.eu.soniox.com', 'https://api.jp.soniox.com',
      'wss://stt-rt.eu.soniox.com', 'wss://stt-rt.jp.soniox.com',
      'wss://tts-rt.eu.soniox.com', 'wss://tts-rt.jp.soniox.com',
      // tts-rt needs BOTH schemes: the one-shot voice preview is HTTPS while
      // the session stream is WSS, and a wss:// entry does not cover https://.
      // The US host already carries the pair for exactly this reason.
      'https://tts-rt.eu.soniox.com', 'https://tts-rt.jp.soniox.com',
    ]) {
      expect(csp).toContain(origin);
    }
  });
});
