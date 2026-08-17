import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isKizunaAIEnabled: () => true,
  // Explicit: each managed provider is gated on its own now, and this mock's
  // promise is that EVERY provider gate is forced on.
  isKizunaSonioxEnabled: () => true,
  isKizunaOpenAITranslateEnabled: () => true,
  isKizunaVolcengineAST2Enabled: () => true,
  isPalabraAIEnabled: () => true,
  isLocalNativeEnabled: () => true,
  isElectron: () => true,
  isExtension: () => false,
  getRelayWsUrl: () => 'wss://r.example/v1',
}));

// The real module (src/locales/index.ts) preloads en/translation.json and
// i18n.init()s at import time, so an unmocked i18n.t() resolves the KEY's
// real resource string, not the caller's defaultValue — masking exactly the
// fallback copy these tests assert on. Same technique as
// prepareToStart.local.test.ts.
vi.mock('../../locales', () => ({
  default: { t: (key: string, def?: string) => def ?? key },
}));

// vi.hoisted: the mock factories below run before these consts would
// otherwise be initialized, and vitest forbids a factory from closing over
// an un-hoisted outer binding.
const { prepareManagedVoice, resolveVoicePrepOutcome, loadVoiceClipMock } = vi.hoisted(() => ({
  prepareManagedVoice: vi.fn(),
  resolveVoicePrepOutcome: vi.fn(),
  loadVoiceClipMock: vi.fn(),
}));

vi.mock('./managedVoicePrep', () => ({ prepareManagedVoice, resolveVoicePrepOutcome }));
vi.mock('../../lib/soniox/voiceClipStorage', () => ({ loadVoiceClip: loadVoiceClipMock }));

import { ProviderConfigFactory } from './ProviderConfigFactory';
import { Provider } from '../../types/Provider';
import { ManagedVoicesClient } from '../clients/ManagedVoicesClient';
import { SONIOX_DEFAULT_VOICE } from '../../lib/soniox/ttsCatalog';

describe('kizuna-soniox prepareToStart', () => {
  const descriptor = () => ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_SONIOX);

  const ports = (
    sessionShapeOverrides: Partial<{ speakerWillStart: boolean; participantWillStart: boolean; textOnly: boolean }> = {}
  ) => ({
    getAuthToken: vi.fn().mockResolvedValue('tok-123'),
    userId: 'user-1',
    revalidate: vi.fn(),
    sessionShape: { speakerWillStart: true, participantWillStart: false, textOnly: false, ...sessionShapeOverrides },
    onPhase: vi.fn(),
    signal: new AbortController().signal,
  });

  beforeEach(() => {
    prepareManagedVoice.mockReset();
    resolveVoicePrepOutcome.mockReset();
    loadVoiceClipMock.mockReset().mockResolvedValue(null);
  });

  it('(1) speakerWillStart:false → bare ok, core never called', async () => {
    const d = descriptor();
    const p = ports({ speakerWillStart: false });
    await expect(d.prepareToStart!({ voice: 'cloned-uuid-123' }, p)).resolves.toEqual({ ok: true });
    expect(prepareManagedVoice).not.toHaveBeenCalled();
    expect(p.onPhase).not.toHaveBeenCalled();
  });

  it('(2) textOnly:true → bare ok, core never called', async () => {
    const d = descriptor();
    const p = ports({ textOnly: true });
    await expect(d.prepareToStart!({ voice: 'cloned-uuid-123' }, p)).resolves.toEqual({ ok: true });
    expect(prepareManagedVoice).not.toHaveBeenCalled();
    expect(p.onPhase).not.toHaveBeenCalled();
  });

  it('(3) a built-in voice in the slice → bare ok, core never called', async () => {
    const d = descriptor();
    const p = ports();
    await expect(d.prepareToStart!({ voice: SONIOX_DEFAULT_VOICE }, p)).resolves.toEqual({ ok: true });
    expect(prepareManagedVoice).not.toHaveBeenCalled();
    expect(p.onPhase).not.toHaveBeenCalled();
  });

  it('(4) an empty voice → bare ok, core never called', async () => {
    const d = descriptor();
    const p = ports();
    await expect(d.prepareToStart!({ voice: '' }, p)).resolves.toEqual({ ok: true });
    expect(prepareManagedVoice).not.toHaveBeenCalled();
    expect(p.onPhase).not.toHaveBeenCalled();
  });

  it('(5a) a cloned UUID: the core is called with a ManagedVoicesClient + a loadClip closure scoped to ports.userId, and a successful outcome maps to sessionPatch/settingsPatch/expect/expectAtApply', async () => {
    prepareManagedVoice.mockResolvedValue({ ok: true, voiceId: 'cloned-uuid-999' });
    resolveVoicePrepOutcome.mockReturnValue({
      sessionVoice: 'cloned-uuid-999',
      settingsPatch: { voice: 'cloned-uuid-999' },
      notice: null,
    });
    const d = descriptor();
    const p = ports();

    const out = await d.prepareToStart!({ voice: 'cloned-uuid-123' }, p);

    expect(prepareManagedVoice).toHaveBeenCalledTimes(1);
    const deps = prepareManagedVoice.mock.calls[0][0];
    expect(deps.client).toBeInstanceOf(ManagedVoicesClient);
    expect(typeof deps.loadClip).toBe('function');
    // Pins the stage's central contract: the same Start-scoped signal object
    // reaches the core, not a copy or a fresh controller — see
    // KizunaAISonioxProviderConfig.ts's `signal: ports.signal`.
    expect(deps.signal).toBe(p.signal);
    await deps.loadClip();
    expect(loadVoiceClipMock).toHaveBeenCalledWith('user-1');

    expect(resolveVoicePrepOutcome).toHaveBeenCalledWith(
      { ok: true, voiceId: 'cloned-uuid-999' },
      'cloned-uuid-123',
      SONIOX_DEFAULT_VOICE
    );

    expect(out).toEqual({
      ok: true,
      sessionPatch: { voice: 'cloned-uuid-999' },
      settingsPatch: { voice: 'cloned-uuid-999' },
      expect: { voice: 'cloned-uuid-123' },
      expectAtApply: { voice: 'cloned-uuid-999' },
    });
  });

  it('(5b) a cloned UUID with a fallback outcome: expectAtApply falls back to the pre-prep voice, no settingsPatch, and the notice is run through i18n', async () => {
    prepareManagedVoice.mockResolvedValue({ ok: false, reason: 'pool_exhausted' });
    resolveVoicePrepOutcome.mockReturnValue({
      sessionVoice: SONIOX_DEFAULT_VOICE,
      settingsPatch: null,
      notice: {
        key: 'mainPanel.sonioxVoicePoolBusy',
        defaultValue:
          'All custom voice slots are in use right now, so this session uses a built-in voice. Your own voice will be used again next time.',
      },
    });
    const d = descriptor();
    const p = ports();

    const out = await d.prepareToStart!({ voice: 'cloned-uuid-123' }, p);

    expect(out).toEqual({
      ok: true,
      sessionPatch: { voice: SONIOX_DEFAULT_VOICE },
      expect: { voice: 'cloned-uuid-123' },
      expectAtApply: { voice: 'cloned-uuid-123' },
      notice:
        'All custom voice slots are in use right now, so this session uses a built-in voice. Your own voice will be used again next time.',
    });
  });

  it('(6) enters preparing-voice before the awaited call and always clears in finally, even if the core unexpectedly rejects', async () => {
    const order: unknown[] = [];
    prepareManagedVoice.mockImplementation(async () => {
      order.push('core-called');
      throw new Error('contract violation: prepareManagedVoice never throws');
    });
    const d = descriptor();
    const p = ports();
    p.onPhase.mockImplementation((phase: unknown) => order.push(phase));

    await expect(d.prepareToStart!({ voice: 'cloned-uuid-123' }, p)).rejects.toThrow();

    // preparing-voice enters BEFORE the await, and null clears it in the
    // finally regardless of how the awaited call settles.
    expect(order).toEqual([{ phase: 'preparing-voice' }, 'core-called', null]);
  });

  it('(7) sessionVoice:null (never-attempted shapes) → ok:true with no sessionPatch', async () => {
    prepareManagedVoice.mockResolvedValue({ ok: true, voiceId: 'cloned-uuid-999' });
    resolveVoicePrepOutcome.mockReturnValue({ sessionVoice: null, settingsPatch: null, notice: null });
    const d = descriptor();
    const p = ports();

    const out = await d.prepareToStart!({ voice: 'cloned-uuid-123' }, p);

    expect(out).toEqual({
      ok: true,
      expect: { voice: 'cloned-uuid-123' },
      expectAtApply: { voice: 'cloned-uuid-123' },
    });
    expect(out).not.toHaveProperty('sessionPatch');
  });

  it('(8) the aborter fires during the core await, which then resolves normally → the hook discards the outcome (bare ok, no sessionPatch/settingsPatch/expect/notice) and still clears onPhase in finally', async () => {
    const controller = new AbortController();
    prepareManagedVoice.mockImplementation(async () => {
      // MainPanel fires startAbortRef mid-flight (a teardown racing this
      // prepare); the core keeps running and resolves normally regardless —
      // it does not know about the signal (ManagedVoicesClient threads a
      // caller signal too as of T4, but this mock replaces
      // prepareManagedVoice wholesale and never exercises that path).
      controller.abort();
      return { ok: true, voiceId: 'cloned-uuid-999' };
    });
    resolveVoicePrepOutcome.mockReturnValue({
      sessionVoice: 'cloned-uuid-999',
      settingsPatch: { voice: 'cloned-uuid-999' },
      notice: null,
    });
    const d = descriptor();
    const p = { ...ports(), signal: controller.signal };

    const out = await d.prepareToStart!({ voice: 'cloned-uuid-123' }, p);

    expect(out).toEqual({ ok: true });
    // The mapping through resolveVoicePrepOutcome never runs once aborted.
    expect(resolveVoicePrepOutcome).not.toHaveBeenCalled();
    // The finally still clears the phase unconditionally.
    expect(p.onPhase).toHaveBeenLastCalledWith(null);
  });
});
