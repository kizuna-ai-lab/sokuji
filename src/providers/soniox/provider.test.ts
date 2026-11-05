/**
 * Soniox's definition (Stage 2 Soniox, Task 11): what generic code reads —
 * its identity under the old enum's id and slice, its capabilities, its
 * own components and functions — and the two things only the whole
 * definition decides: the start gate over its languages and turn modes
 * (D20, ruling 5), and a cancelled start that opens nothing.
 */
import { describe, it, expect, vi } from 'vitest';
import { createVirtualClock } from '../../lib/contract/clock';
import type { SessionContext } from '../../lib/contract/adapter';
import { recordEvents } from '../../lib/contract/events';
import { gate } from '../../lib/session/shape';
import { buildSoniox, describeSoniox } from './config';
import { leaseRequest } from './leaseRequest';
import { sonioxProvider } from './provider';
import { migrateSonioxSettings, SONIOX_DEFAULTS, sonioxCredentials, sonioxLanguages } from './settings';
import { SonioxSettingsView } from './SonioxSettings';
import { SonioxTurnDetectionControls, SonioxTurnDetectionSummary } from './SonioxTurnDetection';
import { KEY, SHARED } from './testing';
import { SonioxIcon } from '../../components/Icons/ProviderIcons';

// The definition's `check` wraps the module's: seen through a spy, not the network.
const { checkSpy } = vi.hoisted(() => ({ checkSpy: vi.fn() }));
vi.mock('./check', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./check')>()),
  checkSoniox: checkSpy,
}));

describe('sonioxProvider', () => {
  it('offers face-to-face (a shared two_way socket with diarization)', () => {
    expect(sonioxProvider.faceToFace).toBe(true);
  });

  it("is Soniox with the user's own key, on every platform, not flagged, under the old enum's id and slice", () => {
    expect(sonioxProvider).toMatchObject({
      id: 'soniox',
      kind: 'own-key',
      platforms: ['electron', 'extension', 'web'],
      guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/soniox-setup',
    });
    expect(sonioxProvider.flagged).toBeUndefined();
    expect(sonioxProvider.icon).toBe(SonioxIcon);
    // An own key names no vendor: that is a managed provider's (Kizuna Soniox, Plan B).
    expect(sonioxProvider).not.toHaveProperty('vendor');
    expect(sonioxProvider.settings.key).toBe('soniox');
    expect(sonioxProvider.settings.defaults).toBe(SONIOX_DEFAULTS);
    expect(sonioxProvider.settings.migrate).toBe(migrateSonioxSettings);
  });

  it('answers split Both (Both, not face-to-face, no shared session) by the one rule the builder and the lease read', () => {
    const SPEAKER = ['speaker'] as const;
    const PARTICIPANT = ['participant'] as const;
    const BOTH = ['speaker', 'participant'] as const;
    const split = (legs: readonly ('speaker' | 'participant')[], faceToFace: boolean, bothModeSharedSession: boolean) =>
      sonioxProvider.splitBoth!({ ...SONIOX_DEFAULTS, bothModeSharedSession }, { legs, faceToFace });
    expect(split(BOTH, false, false)).toBe(true);
    expect(split(BOTH, false, true)).toBe(false);
    expect(split(BOTH, true, false)).toBe(false);
    expect(split(BOTH, true, true)).toBe(false);
    for (const legs of [SPEAKER, PARTICIPANT]) {
      expect(split(legs, false, false)).toBe(false);
      expect(split(legs, false, true)).toBe(false);
    }
    // The same answer as the lease's `bothSplit` and, in Both, the builder's `sharedBoth` inverted.
    const context: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' };
    for (const legs of [SPEAKER, PARTICIPANT, BOTH]) {
      for (const faceToFace of [false, true]) {
        for (const bothModeSharedSession of [false, true]) {
          const s = { ...SONIOX_DEFAULTS, bothModeSharedSession };
          const lease = leaseRequest({ legs, textOnly: false, participantSpeech: false, faceToFace }, s, false);
          expect(split(legs, faceToFace, bothModeSharedSession)).toBe(lease.bothSplit);
          if (legs.length === 2) expect(split(legs, faceToFace, bothModeSharedSession)).toBe(!buildSoniox(context, s, { ...SHARED, faceToFace }).sharedBoth);
        }
      }
    }
  });

  it('speaks optionally, takes no typed text, keeps the provider\'s boundaries, and offers both turn modes', () => {
    expect(sonioxProvider.speech).toBe('optional');
    expect(sonioxProvider.textInput(SONIOX_DEFAULTS)).toBe(false);
    expect(sonioxProvider.boundaries(SONIOX_DEFAULTS)).toBe('provider');
    expect(sonioxProvider.turns(SONIOX_DEFAULTS)).toEqual(['auto', 'manual']);
  });

  it("its components, check, builder and adapter are Soniox's own", async () => {
    const answer = { ok: false as const, reason: 'The key was refused.', code: 'auth' };
    checkSpy.mockResolvedValueOnce(answer);
    const signal = new AbortController().signal;
    const ctx = { pair: { source: 'en', target: 'ja' }, legs: ['speaker'] as const, signal };
    await expect(sonioxProvider.check(KEY, SONIOX_DEFAULTS, ctx)).resolves.toBe(answer);
    expect(checkSpy).toHaveBeenCalledWith(KEY, SONIOX_DEFAULTS, ctx);
    expect(sonioxProvider.Settings).toBe(SonioxSettingsView);
    expect(sonioxProvider.TurnDetection).toEqual({ Summary: SonioxTurnDetectionSummary, Controls: SonioxTurnDetectionControls });
    expect(sonioxProvider.TurnDetection).not.toHaveProperty('Help');
    expect(sonioxProvider.credentials).toBe(sonioxCredentials);
    expect(sonioxProvider.languages).toBe(sonioxLanguages);
    expect(sonioxProvider.build).toBe(buildSoniox);
    expect(sonioxProvider.describe).toBe(describeSoniox);
    expect(sonioxProvider.start).toEqual(expect.any(Function));
    expect(sonioxProvider.session?.startBoth).toEqual(expect.any(Function));
    expect(sonioxProvider.session).not.toHaveProperty('prepare');
    expect(sonioxProvider.session).not.toHaveProperty('admit');
    expect(sonioxProvider.session).not.toHaveProperty('acquire');
  });

  it('the gate refuses Both on an auto source, and lets manual turns through (D20, ruling 5)', () => {
    const both = { provider: sonioxProvider, settings: SONIOX_DEFAULTS, pair: { source: 'auto', target: 'en' }, legs: ['speaker', 'participant'] as const, turnMode: 'auto' as const };
    // An auto source never reverses, so the participant leg has no pair.
    expect(gate(both, 'electron')).toMatchObject({ code: 'participant_unsupported' });
    expect(gate({ ...both, pair: { source: 'ja', target: 'en' } }, 'electron')).toBeNull();
    // Manual turns: endpoint detection stays on, `endTurn` finalizes.
    expect(gate({ ...both, legs: ['speaker'], turnMode: 'push-to-talk' }, 'electron')).toBeNull();
  });

  it('its start refuses a cancelled request before opening any socket', async () => {
    const WebSocket = vi.fn();
    vi.stubGlobal('WebSocket', WebSocket);
    try {
      const context: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' };
      const starting = sonioxProvider.start(
        { context, config: buildSoniox(context, SONIOX_DEFAULTS, SHARED), credentials: KEY, clock: createVirtualClock(0), signal: AbortSignal.abort(new Error('cancelled')) },
        recordEvents().events,
      );
      await expect(starting).rejects.toThrow(/cancelled/);
      expect(WebSocket).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
