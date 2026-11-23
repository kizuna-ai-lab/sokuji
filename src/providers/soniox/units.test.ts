/**
 * Soniox's two units and the definitions that declare them: the text unit is
 * the adapter, which never speaks, the voice is the speech unit, and a plan
 * on Soniox alone, composed or of the provider, holds both.
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
import type { AnyProvider } from '../../lib/provider/types';
import type { SharedSettings } from '../../lib/run/types';
import { legSpeaks } from '../../lib/session/shape';
import { createSonioxAdapter } from './adapter';
import { buildSoniox, buildSonioxAlone, describeSoniox, type SonioxConfig } from './config';
import { createKizunaSonioxProvider, kizunaSonioxProvider } from './kizuna';
import { sonioxAdapter, sonioxProvider } from './provider';
import { SONIOX_DEFAULTS, type SonioxCredentials, type SonioxSettings } from './settings';
import { AUTO_CTX, isStt, KEY, SHARED, trackedClock, type Json } from './testing';
import { SONIOX_TRANSCRIPTION_UNIT, sonioxSttUnitFor, sonioxTranscriptionUnitFor, sonioxUnitsFor } from './units';
import { registerReleasedCatalog } from '../../lib/lineup/catalog.testing';

registerReleasedCatalog();

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

  it("says the turns, boundaries, typed text, face-to-face and participant's speech the definition said, and never speaks itself", () => {
    for (const unit of [unitsOf(sonioxProvider)[0], unitsOf(kizunaSonioxProvider)[0]]) {
      expect(unit.capabilities(SONIOX_DEFAULTS)).toEqual({
        speech: 'never',
        turns: ['auto', 'manual'],
        turnOwner: 'either',
        boundaries: 'provider',
        textInput: false,
        faceToFace: true,
        participantSpeech: true,
      });
    }
    expect(sonioxSttUnitFor({ start, participantSpeech: false }).capabilities(SONIOX_DEFAULTS).participantSpeech).toBe(false);
  });

  it('builds what the definition builds, the same whether the leg speaks or not: no voice, and the STT model alone', () => {
    const settings: SonioxSettings[] = [SONIOX_DEFAULTS, { ...SONIOX_DEFAULTS, bothModeSharedSession: false, speakerLabels: false, endpointSensitivity: 0.4 }];
    for (const s of settings) {
      for (const shared of [SHARED, { ...SHARED, faceToFace: true }, { ...SHARED, reversed: () => true }] as SharedSettings[]) {
        const config = stt.build(SILENT, s, shared) as SonioxConfig;
        expect(config).toEqual(buildSoniox(SILENT, s, shared));
        expect(config).not.toHaveProperty('tts');
        // What `startBoth` reads is carried.
        expect(config).toMatchObject({ sharedBoth: shared.faceToFace === true || s.bothModeSharedSession, diarize: s.speakerLabels && shared.reversed(SILENT.direction) });
        expect(Boolean(config.faceToFace)).toBe(shared.faceToFace === true);
        expect(stt.build(AUTO_CTX, s, shared)).toEqual(config);
        expect(stt.describe(config)).toEqual({ asrModel: 'stt-rt-v6' });
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

describe("Soniox's unit that transcribes alone", () => {
  const alone = sonioxTranscriptionUnitFor({ start });

  it('occupies transcription when asked for exactly that, and nothing else', () => {
    expect(alone.id).toBe(SONIOX_TRANSCRIPTION_UNIT);
    expect(alone.start).toBe(start);
    expect(alone.startTranslation).toBeUndefined();
    expect(isSpeechUnit(alone)).toBe(false);
    expect(alone.occupies(SONIOX_DEFAULTS, new Set(['transcription']))).toEqual(['transcription']);
    for (const want of [RUN_STAGES, TR_TL, ['translation'], ['speech'], ['translation', 'speech'], ['transcription', 'speech'], []] as RunStage[][]) {
      expect(alone.occupies(SONIOX_DEFAULTS, new Set(want)), want.join('+')).toBeNull();
    }
  });

  it("keeps the connection's turns, boundaries and typed text, and is not face-to-face", () => {
    const { faceToFace: _f, ...together } = stt.capabilities(SONIOX_DEFAULTS);
    expect(alone.capabilities(SONIOX_DEFAULTS)).toEqual({ ...together, faceToFace: false });
    expect(sonioxTranscriptionUnitFor({ start, participantSpeech: false }).capabilities(SONIOX_DEFAULTS).participantSpeech).toBe(false);
  });

  it('builds a config that says it transcribes alone, the same whether the leg speaks or not, and names no translation model', () => {
    for (const shared of [SHARED, { ...SHARED, faceToFace: true }, { ...SHARED, reversed: () => true }] as SharedSettings[]) {
      const config = alone.build(SILENT, SONIOX_DEFAULTS, shared) as SonioxConfig;
      expect(config).toEqual(buildSonioxAlone(SILENT, SONIOX_DEFAULTS, shared));
      expect(config).toMatchObject({ transcribesAlone: true, sharedBoth: false });
      expect(alone.build(AUTO_CTX, SONIOX_DEFAULTS, shared)).toEqual(config);
      expect(alone.describe(config)).toEqual({ asrModel: 'stt-rt-v6' });
    }
  });

  it('is declared by both definitions, and is the one unit of each that occupies transcription alone', () => {
    for (const p of [sonioxProvider, kizunaSonioxProvider] as AnyProvider[]) {
      const serving = unitsOf(p).filter((u) => u.occupies(SONIOX_DEFAULTS, new Set(['transcription'])) !== null);
      expect(serving.map((u) => u.id)).toEqual([SONIOX_TRANSCRIPTION_UNIT]);
      expect(serving[0].start).toBe(sonioxAdapter.start);
    }
  });
});

describe('the Soniox definitions declare their units', () => {
  it('each declares its text unit, its unit that transcribes alone and its voice, over the same adapter, with its own participant-speech flag', () => {
    for (const p of [sonioxProvider, kizunaSonioxProvider] as AnyProvider[]) {
      const units = unitsOf(p);
      expect(units).toBe(p.units);
      expect(units.map((u) => u.id)).toEqual(['stt', SONIOX_TRANSCRIPTION_UNIT, 'tts']);
      expect(units[0].start).toBe(sonioxAdapter.start);
      expect(units[1].start).toBe(sonioxAdapter.start);
      expect(isSpeechUnit(units[2])).toBe(true);
      expect(units[2].start).toBeUndefined();
      // The text unit builds and describes as the definition did.
      expect(units[0].build).toBe(buildSoniox);
      expect(units[0].describe).toBe(describeSoniox);
      expect(p.session!.startBoth).toBe(sonioxProvider.session!.startBoth);
    }
    const off = createKizunaSonioxProvider({ participantSpeech: false });
    expect(unitsOf(off).map((u) => u.capabilities(SONIOX_DEFAULTS).participantSpeech)).toEqual([false, false, false]);
    expect(unitsOf(kizunaSonioxProvider).map((u) => u.capabilities(SONIOX_DEFAULTS).participantSpeech)).toEqual([true, true, true]);
    expect(sonioxUnitsFor({ start }).map((u) => u.capabilities(SONIOX_DEFAULTS).participantSpeech)).toEqual([true, true, true]);
  });

  it.each([sonioxProvider, kizunaSonioxProvider] as AnyProvider[])('the plan of $id alone is its two units, composed or of the provider', (p) => {
    const plan = planOf(p);
    const [text, , voice] = unitsOf(p);
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
          expect(legSpeaks(capabilitiesOf(shape, 'speech'), leg, { textOnly, participantSpeech })).toBe(legSpeaks({ speech: 'optional' }, leg, { textOnly, participantSpeech }));
        }
      }
    }
    expect(capabilitiesOf(shape, 'transcription')).toMatchObject({ turns: ['auto', 'manual'], boundaries: 'provider', textInput: false, faceToFace: true });
  });

  it("a leg is built unit by unit: the text side's config, the voice in its own, and each names its model", () => {
    const plan = planOf(sonioxProvider);
    const shape = { accounts: { soniox: { settings: SONIOX_DEFAULTS, credentials: {} } } };
    for (const context of [AUTO_CTX, SILENT]) {
      const configs = buildPlan(plan, context, shape, SHARED);
      if ('refused' in configs) throw new Error('refused');
      expect(configs.get(plan.byStage.transcription)).toEqual(buildSoniox(context, SONIOX_DEFAULTS, SHARED));
      // A leg that speaks: its voice and speed. One that does not: the same, marked off, and no speech model.
      expect(configs.get(plan.byStage.speech)).toEqual({ voice: 'Adrian', speed: 1, ...(context.speech ? {} : { off: true }) });
      expect(describePlan(plan, configs)).toEqual({ asrModel: 'stt-rt-v6', ...(context.speech ? { ttsModel: 'tts-rt-v2' } : {}) });
    }
  });
});
