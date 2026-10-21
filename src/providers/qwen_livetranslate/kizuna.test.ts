/**
 * Kizuna AI's managed Qwen LiveTranslate: the definition `managed(qwen)`
 * composes — Qwen's languages, builder and adapter under its own id and
 * slice, the sign-in for a key, the lease and the floor.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { render } from '@testing-library/react';
import { kizunaQwenProvider } from './kizuna';
import { qwenLiveTranslateProvider } from './provider';
import { KizunaQwenSettingsView, QwenVoiceSummary } from './QwenSettings';
import { QWEN_DEFAULTS } from './settings';

const getToken = async () => 'tok';

afterEach(() => vi.unstubAllGlobals());

describe('kizunaQwenProvider', () => {
  it("is Kizuna AI's Qwen: managed, flagged, on the desktop and the extension, under its own slice", () => {
    expect(kizunaQwenProvider).toMatchObject({ id: 'kizunaai_qwen', kind: 'managed', vendor: 'Qwen', flagged: true, platforms: ['electron', 'extension'] });
    expect(kizunaQwenProvider.settings).toMatchObject({ key: 'kizunaQwen', defaults: QWEN_DEFAULTS });
    expect(kizunaQwenProvider.testerSwitch).toBeUndefined();
    expect(kizunaQwenProvider.icon).toBeTypeOf('function');
    expect(kizunaQwenProvider.Settings).toBe(KizunaQwenSettingsView);
    expect(kizunaQwenProvider.VoiceSummary).toBe(QwenVoiceSummary);
  });

  it("badges the Kizuna mark with Qwen's glyph in white on Qwen's purple", () => {
    // The colour mark's transparent ground let the Kizuna mark's white strokes
    // through, and a white plate would twin Kizuna Soniox's badge.
    const { container } = render(createElement(kizunaQwenProvider.icon, { size: 20 }));
    const badge = container.querySelector('.hosted-provider-icon__badge') as HTMLElement;

    expect(badge.getAttribute('style')).toContain('linear-gradient');
    expect(container.querySelector('path')!.getAttribute('fill')).toBe('currentColor');
    expect(container.querySelector('svg')!.style.color).toBe('rgb(255, 255, 255)');
  });

  it('has no credential field, reads the sign-in and checks nothing', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(kizunaQwenProvider.credentials.keys).toEqual([]);
    expect(kizunaQwenProvider.credentials.fields(QWEN_DEFAULTS)).toEqual([]);
    expect(kizunaQwenProvider.credentials.read({}, { signedIn: false, getToken })).toEqual({ missing: 'Sign in to use Kizuna AI Qwen.', code: 'sign_in_required' });
    expect(kizunaQwenProvider.credentials.read({}, { signedIn: true, loaded: false, getToken })).toMatchObject({ code: 'sign_in_pending' });
    expect(kizunaQwenProvider.credentials.read({}, { signedIn: true, userId: 'u1', getToken })).toEqual({ signedIn: true });
    await expect(kizunaQwenProvider.check({ signedIn: true }, QWEN_DEFAULTS, { pair: { source: 'en', target: 'ja' }, legs: ['speaker'] })).resolves.toEqual({ ok: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("is Qwen's languages, capabilities, builder and adapter", () => {
    for (const member of ['languages', 'speech', 'textInput', 'boundaries', 'turns', 'build', 'describe', 'start', 'TurnDetection'] as const) {
      expect(kizunaQwenProvider[member], member).toBe(qwenLiveTranslateProvider[member]);
    }
  });

  it('adds the lease and the floor', () => {
    const session = kizunaQwenProvider.session!;
    expect(session.acquire).toBeTypeOf('function');
    expect(session.minimumBalance).toBeTypeOf('function');
    // The floor follows the region picked: Singapore's 42 630 µUSD for a speaking leg, Beijing's 30 150.
    expect(session.minimumBalance!({ legs: ['speaker'], textOnly: false, participantSpeech: false }, QWEN_DEFAULTS)).toBe(42_630);
    expect(session.minimumBalance!({ legs: ['speaker'], textOnly: false, participantSpeech: false }, { ...QWEN_DEFAULTS, region: 'cn' })).toBe(30_150);
  });
});
