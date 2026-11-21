/**
 * Soniox's two units and the definitions that declare them: the text unit is
 * the adapter built for a leg that does not speak, the voice is the speech
 * unit, and a plan on Soniox alone, composed or of the provider, holds both.
 */
import { describe, it, expect, vi } from 'vitest';
import type { SessionContext } from '../../lib/contract/adapter';
import { recordEvents } from '../../lib/contract/events';
import { FakeSocket, fakeSockets } from '../../lib/contract/testing/fakeSocket';
import { flush } from '../../lib/contract/testing/drive';
import { RUN_STAGES, TR_TL } from '../../lib/lineup/types';
import type { RunStage } from '../../lib/lineup/types';
import { compose } from '../../lib/plan/compose';
import { buildPlan, describePlan } from '../../lib/plan/composite';
import { textAndSpeech } from '../../lib/plan/compositeLeg';
import { capabilitiesOf } from '../../lib/plan/read';
import { planOf } from '../../lib/plan/testing';
import { isSpeechUnit, type RunPlan } from '../../lib/plan/types';
import { unitsOf } from '../../lib/plan/wholeUnit';
import type { AnyProvider, SharedSettings } from '../../lib/provider/types';
import { legSpeaks } from '../../lib/session/shape';
import { createSonioxAdapter } from './adapter';
import { buildSoniox, describeSoniox, type SonioxConfig } from './config';
import { createKizunaSonioxProvider, kizunaSonioxProvider } from './kizuna';
import { sonioxProvider } from './provider';
import { SONIOX_DEFAULTS, type SonioxCredentials, type SonioxSettings } from './settings';
import { AUTO_CTX, isStt, KEY, SHARED, trackedClock, type Json } from './testing';
import { sonioxSttUnitFor, sonioxUnitsFor } from './units';

const start = vi.fn();
const stt = sonioxSttUnitFor({ start });
const SILENT: SessionContext = { ...AUTO_CTX, speech: false };
const all = (id: string) => ({ transcription: id, translation: id, speech: id });

describe("Soniox's text unit", () => {
  it('occupies transcription and translation when asked for exactly those, and nothing else', () => {
    expect(stt.id).toBe('stt');
    expect(isSpeechUnit(stt)).toBe(false);
    expect(stt.start).toBe(start);
    expect(stt.occupies(SONIOX_DEFAULTS, new Set(TR_TL))).toEqual(TR_TL);
    for (const want of [RUN_STAGES, ['transcription'], ['translation'], ['speech'], ['translation', 'speech'], ['transcription', 'speech'], []] as RunStage[][]) {
      expect(stt.occupies(SONIOX_DEFAULTS, new Set(want)), want.join('+')).toBeNull();
    }
  });

  it("says what the definition says of turns, boundaries, typed text, face-to-face and the participant's speech, and never speaks itself", () => {
    for (const [unit, p] of [[unitsOf(sonioxProvider)[0], sonioxProvider], [unitsOf(kizunaSonioxProvider)[0], kizunaSonioxProvider]] as const) {
      expect(unit.capabilities(SONIOX_DEFAULTS)).toEqual({
        speech: 'never',
        turns: p.turns(SONIOX_DEFAULTS),
        turnOwner: 'either',
        boundaries: p.boundaries(SONIOX_DEFAULTS),
        textInput: p.textInput(SONIOX_DEFAULTS),
        faceToFace: p.faceToFace === true,
        participantSpeech: p.participantSpeech !== false,
      });
    }
    expect(sonioxSttUnitFor({ start, participantSpeech: false }).capabilities(SONIOX_DEFAULTS).participantSpeech).toBe(false);
  });

  it('builds what the whole provider builds for a leg that does not speak: no voice, and the STT model alone', () => {
    const settings: SonioxSettings[] = [SONIOX_DEFAULTS, { ...SONIOX_DEFAULTS, bothModeSharedSession: false, speakerLabels: false, endpointSensitivity: 0.4 }];
    for (const s of settings) {
      for (const shared of [SHARED, { ...SHARED, faceToFace: true }, { ...SHARED, reversed: () => true }] as SharedSettings[]) {
        const config = stt.build(SILENT, s, shared) as SonioxConfig;
        expect(config).toEqual(buildSoniox(SILENT, s, shared));
        expect(config).not.toHaveProperty('tts');
        // All of the speaking leg's config but the voice: what `startBoth` reads is carried.
        const { tts: _voice, ...text } = buildSoniox(AUTO_CTX, s, shared);
        expect(config).toEqual(text);
        expect(stt.describe(config)).toEqual({ asrModel: describeSoniox(config).asrModel });
      }
    }
  });

  it('asks for agent text when some leg of the run speaks, whoever speaks, with the setting on', () => {
    const on = { ...SONIOX_DEFAULTS, agentText: true };
    const speaks: SharedSettings = { ...SHARED, speaks: true };
    // Built for no speech of its own: the voice is another unit's, and the microphone still hears it.
    expect((stt.build(SILENT, on, speaks) as SonioxConfig).stt.agentText).toBe(true);
    expect((stt.build(SILENT, on, SHARED) as SonioxConfig).stt).not.toHaveProperty('agentText');
    expect((stt.build(SILENT, { ...SONIOX_DEFAULTS, agentText: false }, speaks) as SonioxConfig).stt).not.toHaveProperty('agentText');
    // The participant's leg never asks: its socket does not hear the microphone.
    expect((stt.build(SILENT, on, { ...speaks, reversed: () => true }) as SonioxConfig).stt).not.toHaveProperty('agentText');
  });

  it('started with its config and credentials that hold no speech key: no TTS socket opens and nothing is said of the key', async () => {
    const sockets = fakeSockets();
    const { clock } = trackedClock();
    const { events, log } = recordEvents();
    const unit = sonioxSttUnitFor({ start: createSonioxAdapter({ openSocket: sockets.create }).start });
    const textOnly: SonioxCredentials = { region: 'us', stt: 'k-stt' };
    for (const credentials of [textOnly, KEY]) {
      const config = unit.build(SILENT, { ...SONIOX_DEFAULTS, agentText: true }, { ...SHARED, speaks: true }) as SonioxConfig;
      const starting = unit.start!({ context: SILENT, config, credentials, clock, signal: new AbortController().signal }, events);
      for (const s of sockets.all) if (s.readyState === FakeSocket.CONNECTING) s.open();
      const session = await starting;
      await flush();
      expect(sockets.all.every(isStt)).toBe(true);
      expect(sockets.all[sockets.all.length - 1].sentJson<Json>()[0].enable_agent_text_input).toBe(true);
      expect(log.filter((e) => e.kind === 'degraded')).toEqual([]);
      await session.stop();
    }
  });
});

describe('the Soniox definitions declare their units', () => {
  it('each declares its text unit and its voice, over the same adapter, with its own participant-speech flag', () => {
    for (const p of [sonioxProvider, kizunaSonioxProvider] as AnyProvider[]) {
      const units = unitsOf(p);
      expect(units).toBe(p.units);
      expect(units.map((u) => u.id)).toEqual(['stt', 'tts']);
      expect(units[0].start).toBe(sonioxProvider.start);
      expect(isSpeechUnit(units[1])).toBe(true);
      expect(units[1].start).toBeUndefined();
      // The definition's own members stay, for a reader not yet on units.
      expect(p.speech).toBe('optional');
      expect(p.build).toBe(buildSoniox);
      expect(p.describe).toBe(describeSoniox);
      expect(p.session!.startBoth).toBe(sonioxProvider.session!.startBoth);
    }
    const off = createKizunaSonioxProvider({ participantSpeech: false });
    expect(unitsOf(off).map((u) => u.capabilities(SONIOX_DEFAULTS).participantSpeech)).toEqual([false, false]);
    expect(unitsOf(kizunaSonioxProvider).map((u) => u.capabilities(SONIOX_DEFAULTS).participantSpeech)).toEqual([true, true]);
    expect(sonioxUnitsFor({ start }).map((u) => u.capabilities(SONIOX_DEFAULTS).participantSpeech)).toEqual([true, true]);
  });

  it.each([sonioxProvider, kizunaSonioxProvider] as AnyProvider[])('the plan of $id alone is its two units, composed or of the provider', (p) => {
    const plan = planOf(p);
    const [text, voice] = unitsOf(p);
    expect(plan.units.map((u) => [u.unit, u.stages])).toEqual([[text, TR_TL], [voice, ['speech']]]);
    expect(RUN_STAGES.map((stage) => plan.byStage[stage])).toEqual([plan.units[0], plan.units[0], plan.units[1]]);
    expect(textAndSpeech(plan)).toEqual({ text: plan.units[0], speech: plan.units[1] });
    const composed = compose(all(p.id), { providers: [p], settings: () => SONIOX_DEFAULTS }) as RunPlan;
    expect(composed).toEqual(plan);
  });

  it.each([sonioxProvider, kizunaSonioxProvider] as AnyProvider[])("whether a leg of $id speaks is read from its voice as it was from the definition", (p) => {
    const shape = { plan: planOf(p), accounts: { [p.id]: { settings: SONIOX_DEFAULTS, credentials: {} } } };
    for (const textOnly of [false, true]) {
      for (const participantSpeech of [false, true]) {
        for (const leg of ['speaker', 'participant'] as const) {
          expect(legSpeaks(capabilitiesOf(shape, 'speech'), leg, { textOnly, participantSpeech })).toBe(legSpeaks(p, leg, { textOnly, participantSpeech }));
        }
      }
    }
    expect(capabilitiesOf(shape, 'transcription')).toMatchObject({ turns: ['auto', 'manual'], boundaries: 'provider', textInput: false, faceToFace: true });
  });

  it('a leg is built and described as the whole provider builds and describes it, the voice in its own config', () => {
    const plan = planOf(sonioxProvider);
    const shape = { accounts: { soniox: { settings: SONIOX_DEFAULTS, credentials: {} } } };
    for (const context of [AUTO_CTX, SILENT]) {
      const configs = buildPlan(plan, context, shape, SHARED);
      if ('refused' in configs) throw new Error('refused');
      const whole = buildSoniox(context, SONIOX_DEFAULTS, SHARED);
      const { tts, ...text } = whole;
      expect(configs.get(plan.byStage.transcription)).toEqual(text);
      // A leg that speaks: the voice and speed the whole provider gives it.
      if (tts) expect(configs.get(plan.byStage.speech)).toEqual(tts);
      // The same models, and no speech model for a leg that does not speak.
      expect(describePlan(plan, configs)).toEqual(describeSoniox(whole));
    }
  });
});
