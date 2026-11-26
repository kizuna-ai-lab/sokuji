import { describe, expect, it } from 'vitest';
import { RELEASED } from '../../providers/registry';
import { choiceInput } from './choice';
import { compose } from './compose';
import { isRefusal } from './types';
import { allCaps, caps, goesWith, hostDefaults } from '../lineup/catalog';
import { choose as chooseWith } from './choose';
import { RUN_STAGES } from '../lineup/types';
import type { LineUp, RunStage } from '../lineup/types';

const soniox = { transcription: 'soniox', translation: 'soniox', speech: 'soniox', summarisation: null };
const kizuna = { transcription: 'kizunaai_soniox', translation: 'kizunaai_soniox', speech: 'kizunaai_soniox', summarisation: null };
const local = { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null };
const gemini = { transcription: 'gemini', translation: 'gemini', speech: 'gemini', summarisation: null };

// The released providers under their default settings: what the line-up page and the store ask the composer with
// before an entry loads.
const input = choiceInput(RELEASED, {});
const choose = (lineUp: LineUp, stage: Parameters<typeof chooseWith>[1], id: string | null) => chooseWith(lineUp, stage, id, input);
// The same, under a catalog in which Kizuna AI's Soniox voice is not offered alone: no released option makes a
// voice follow any more, and the rule is kept for a voice that reads only its own translation.
const notAlone = { ...input, catalog: allCaps().map((c) => (c.id === 'kizunaai_soniox' ? { ...c, voiceAlone: false } : c)) };
const chooseNotAlone = (lineUp: LineUp, stage: Parameters<typeof chooseWith>[1], id: string | null) => chooseWith(lineUp, stage, id, notAlone);

/** Every triple of options in the catalog, without notes. */
function everyLineUp(): LineUp[] {
  const lineUps: LineUp[] = [];
  for (const t of allCaps()) for (const tl of allCaps()) for (const s of allCaps()) lineUps.push({ transcription: t.id, translation: tl.id, speech: s.id, summarisation: null });
  return lineUps;
}

/** The composer's refusals a line-up reached by choosing can meet, under the released providers' default settings. */
const REACHABLE_REFUSALS: string[] = [];

describe('choosing a provider for a stage', () => {
  it("Soniox chosen for translation takes the transcription too (it translates only what it transcribes), and leaves the others alone", () => {
    expect(choose(local, 'translation', 'soniox')).toEqual({ lineUp: { ...soniox, speech: 'edge' }, moved: ['transcription'] });
    expect(choose(local, 'translation', 'kizunaai_soniox')).toEqual({ lineUp: { ...kizuna, speech: 'edge' }, moved: ['transcription'] });
    // From one Soniox to the other, with another translator between: the transcription follows the translation chosen.
    expect(choose({ ...kizuna, translation: 'bing' }, 'translation', 'soniox')).toEqual({ lineUp: { ...soniox, speech: 'kizunaai_soniox' }, moved: ['transcription'] });
    // Already transcribing: nothing else moves.
    expect(choose({ ...soniox, translation: 'bing' }, 'translation', 'soniox')).toEqual({ lineUp: soniox, moved: [] });
  });

  it('Bing or this device chosen for translation on a Soniox line-up keeps Soniox transcribing', () => {
    for (const from of [soniox, kizuna, { ...soniox, speech: 'edge' }, { ...kizuna, speech: 'soniox' }]) {
      for (const id of ['bing', 'local_inference']) {
        const chosen = choose(from, 'translation', id);
        expect(chosen).toEqual({ lineUp: { ...from, translation: id }, moved: [] });
        expect(isRefusal(compose(chosen.lineUp, input)), JSON.stringify(chosen.lineUp)).toBe(false);
      }
    }
  });

  it('Soniox chosen for transcription keeps a translation by Bing or by this device', () => {
    expect(choose(local, 'transcription', 'soniox')).toEqual({ lineUp: { ...local, transcription: 'soniox' }, moved: [] });
    expect(choose({ ...local, translation: 'local_inference' }, 'transcription', 'kizunaai_soniox')).toEqual({ lineUp: { ...local, transcription: 'kizunaai_soniox', translation: 'local_inference' }, moved: [] });
    // Between the two Soniox, the translator between them stays.
    expect(choose({ ...soniox, translation: 'bing' }, 'transcription', 'kizunaai_soniox')).toEqual({ lineUp: { ...kizuna, translation: 'bing', speech: 'soniox' }, moved: [] });
  });

  it("Soniox's translation goes with its transcription when another provider is chosen to transcribe", () => {
    expect(choose(soniox, 'transcription', 'local_inference')).toEqual({ lineUp: { ...local, speech: 'soniox' }, moved: ['translation'] });
    expect(choose(soniox, 'transcription', 'kizunaai_soniox')).toEqual({ lineUp: { ...kizuna, speech: 'soniox' }, moved: ['translation'] });
  });
  it('an end-to-end provider takes all three and leaves the notes alone', () => {
    expect(choose({ ...soniox, summarisation: 'x' }, 'speech', 'openai_live').lineUp).toEqual({ transcription: 'openai_live', translation: 'openai_live', speech: 'openai_live', summarisation: 'x' });
  });
  it('a text model chosen for translation keeps a transcriber that stands alone, Soniox (either) or this device, and its voice', () => {
    for (const from of [soniox, kizuna, local, { ...soniox, speech: 'edge' }, { ...local, speech: 'soniox' }, { ...kizuna, translation: 'bing' }]) {
      for (const id of ['openai_text', 'gemini_text', 'openai_compatible']) {
        const chosen = choose(from, 'translation', id);
        expect(chosen, `${JSON.stringify(from)} ${id}`).toEqual({ lineUp: { ...from, translation: id }, moved: [] });
        expect(isRefusal(compose(chosen.lineUp, input)), JSON.stringify(chosen.lineUp)).toBe(false);
      }
    }
  });

  it("a text model chosen for translation under an end-to-end provider moves its transcription and voice to this device's defaults: this device's recognition and Edge", () => {
    for (const from of [gemini, { transcription: 'openai_live', translation: 'openai_live', speech: 'openai_live', summarisation: null }, { transcription: 'kizunaai_qwen', translation: 'kizunaai_qwen', speech: 'kizunaai_qwen', summarisation: 'x' }]) {
      const chosen = choose(from, 'translation', 'openai_text');
      // An end-to-end provider's voice goes with its joint group, unsaid; Qwen's voice reads only its own text, so it follows, and that is said.
      const followed = from.speech === 'kizunaai_qwen' ? { followed: { stage: 'speech', from: 'kizunaai_qwen', to: 'edge' } } : {};
      expect(chosen).toEqual({ lineUp: { transcription: 'local_inference', translation: 'openai_text', speech: 'edge', summarisation: from.summarisation }, moved: ['transcription', 'speech'], ...followed });
      const plan = compose(chosen.lineUp, input);
      expect(isRefusal(plan)).toBe(false);
      // Recognition alone on this device, the text model, and Edge, a provider of its own: three units.
      if (!isRefusal(plan)) expect(plan.units.map((u) => [u.provider.id, u.unit.id])).toEqual([['local_inference', 'transcription'], ['openai_text', 'translation'], ['edge', 'speech']]);
    }
  });

  it('a transcriber chosen over a text model keeps it, where it transcribes alone; an end-to-end provider takes the translation back', () => {
    const textLineUp = { ...soniox, translation: 'gemini_text' };
    expect(choose(textLineUp, 'transcription', 'local_inference')).toEqual({ lineUp: { ...textLineUp, transcription: 'local_inference' }, moved: [] });
    expect(choose(textLineUp, 'transcription', 'kizunaai_soniox')).toEqual({ lineUp: { ...textLineUp, transcription: 'kizunaai_soniox' }, moved: [] });
    expect(choose(textLineUp, 'transcription', 'gemini').lineUp).toMatchObject(gemini);
    // Soniox chosen to translate takes its own transcription with it, as from any other translator.
    expect(choose({ ...local, translation: 'openai_text' }, 'translation', 'soniox')).toEqual({ lineUp: { ...soniox, speech: 'edge' }, moved: ['transcription'] });
  });

  it('on the local host a single stage changes alone', () => { expect(choose(local, 'translation', 'local_inference')).toEqual({ lineUp: { ...local, translation: 'local_inference' }, moved: [] }); });

  it('a voice chosen under another provider\'s text moves nothing', () => {
    expect(choose(soniox, 'speech', 'edge')).toEqual({ lineUp: { ...soniox, speech: 'edge' }, moved: [] });
    expect(choose(kizuna, 'speech', 'edge')).toEqual({ lineUp: { ...kizuna, speech: 'edge' }, moved: [] });
    expect(choose(kizuna, 'speech', 'local_inference')).toEqual({ lineUp: { ...kizuna, speech: 'local_inference' }, moved: [] });
    expect(choose(local, 'speech', 'soniox')).toEqual({ lineUp: { ...local, speech: 'soniox' }, moved: [] });
  });
  it('a text side chosen over another provider\'s voice keeps that voice', () => {
    expect(choose(local, 'transcription', 'soniox')).toEqual({ lineUp: { ...local, transcription: 'soniox' }, moved: [] });
    expect(choose(gemini, 'transcription', 'soniox')).toEqual({ lineUp: soniox, moved: ['translation', 'speech'] });
    expect(choose(soniox, 'transcription', 'kizunaai_soniox').lineUp).toMatchObject({ transcription: 'kizunaai_soniox', translation: 'kizunaai_soniox', speech: 'soniox' });
  });

  it('a provider that loses a stage another of its stages needs loses that one too, to the chosen host\'s defaults', () => {
    // Soniox translates only what it transcribes: taking its transcription away takes its translation, and its voice stays.
    expect(choose(soniox, 'transcription', 'local_inference')).toEqual({ lineUp: { transcription: 'local_inference', translation: 'bing', speech: 'soniox', summarisation: null }, moved: ['translation'] });
    // An end-to-end provider holds all three together: taking its voice away takes the rest.
    expect(choose(gemini, 'speech', 'edge')).toEqual({ lineUp: local, moved: ['transcription', 'translation'] });
    expect(choose(gemini, 'transcription', 'soniox')).toEqual({ lineUp: soniox, moved: ['translation', 'speech'] });
  });

  it("Kizuna AI's Soniox voice stays beside another text side: it is offered alone, so nothing follows", () => {
    // Own-key Soniox for the text, under Kizuna AI's Soniox on every stage: the hosted voice reads it.
    const toSoniox = choose(kizuna, 'transcription', 'soniox');
    expect(toSoniox).toEqual({ lineUp: { ...soniox, speech: 'kizunaai_soniox' }, moved: ['translation'] });
    expect(isRefusal(compose(toSoniox.lineUp, input))).toBe(false);
    expect(choose(kizuna, 'translation', 'soniox')).toEqual({ lineUp: { ...soniox, speech: 'kizunaai_soniox' }, moved: ['transcription'] });
    // This device for the text: the same.
    const toLocal = choose(kizuna, 'transcription', 'local_inference');
    expect(toLocal).toEqual({ lineUp: { ...local, speech: 'kizunaai_soniox' }, moved: ['translation'] });
    expect(isRefusal(compose(toLocal.lineUp, input))).toBe(false);
    // Bing for the translation alone: the hosted transcription and the hosted voice both stay.
    expect(choose(kizuna, 'translation', 'bing')).toEqual({ lineUp: { ...kizuna, translation: 'bing' }, moved: [] });
    expect(isRefusal(compose({ ...kizuna, translation: 'bing' }, input))).toBe(false);
    // Kizuna AI's Qwen for the text: the two hosted services never run together, so the hosted voice goes to Qwen's.
    expect(choose({ ...soniox, speech: 'kizunaai_soniox' }, 'transcription', 'kizunaai_qwen')).toEqual({
      lineUp: { transcription: 'kizunaai_qwen', translation: 'kizunaai_qwen', speech: 'kizunaai_qwen', summarisation: null }, moved: ['translation', 'speech'],
    });
  });

  it('a voice that cannot stay beside the chosen text side follows it, and the result says so (a voice not offered alone)', () => {
    // A voice that only reads its own translation: with own-key Soniox for the text, speech goes to Soniox's voice.
    const toSoniox = chooseNotAlone(kizuna, 'transcription', 'soniox');
    expect(toSoniox).toEqual({ lineUp: soniox, moved: ['translation', 'speech'], followed: { stage: 'speech', from: 'kizunaai_soniox', to: 'soniox' } });
    expect(isRefusal(compose(toSoniox.lineUp, notAlone))).toBe(false);
    expect(chooseNotAlone(kizuna, 'translation', 'soniox')).toEqual({ lineUp: soniox, moved: ['transcription', 'speech'], followed: { stage: 'speech', from: 'kizunaai_soniox', to: 'soniox' } });
    // With this device for the text, to this device's default voice.
    const toLocal = chooseNotAlone(kizuna, 'transcription', 'local_inference');
    expect(toLocal).toEqual({ lineUp: local, moved: ['translation', 'speech'], followed: { stage: 'speech', from: 'kizunaai_soniox', to: 'edge' } });
    expect(isRefusal(compose(toLocal.lineUp, notAlone))).toBe(false);
    // Another translator under its transcription: the voice would read a translation that is not its own.
    expect(chooseNotAlone(kizuna, 'translation', 'bing')).toEqual({ lineUp: { ...kizuna, translation: 'bing', speech: 'edge' }, moved: ['speech'], followed: { stage: 'speech', from: 'kizunaai_soniox', to: 'edge' } });
    // A stored line-up that was already refused for its voice is put right by the next choice of a text side.
    expect(chooseNotAlone({ ...soniox, speech: 'kizunaai_soniox' }, 'transcription', 'local_inference').followed).toEqual({ stage: 'speech', from: 'kizunaai_soniox', to: 'edge' });
  });

  it('a voice that can stay beside the chosen text side stays', () => {
    // Edge reads any text side that takes another voice.
    expect(choose({ ...kizuna, speech: 'edge' }, 'transcription', 'soniox')).toEqual({ lineUp: { ...soniox, speech: 'edge' }, moved: ['translation'] });
    // Soniox's own-key voice stands alone, and Kizuna AI's text takes another voice.
    expect(choose(soniox, 'transcription', 'kizunaai_soniox')).toEqual({ lineUp: { ...kizuna, speech: 'soniox' }, moved: ['translation'] });
    expect(isRefusal(compose({ ...kizuna, speech: 'soniox' }, input))).toBe(false);
  });

  it("Kizuna AI's Soniox voice chosen under another provider's text moves nothing, and the line-up runs", () => {
    for (const from of [soniox, local, { ...local, translation: 'local_inference' }]) {
      const chosen = choose(from, 'speech', 'kizunaai_soniox');
      expect(chosen).toEqual({ lineUp: { ...from, speech: 'kizunaai_soniox' }, moved: [] });
      expect(isRefusal(compose(chosen.lineUp, input))).toBe(false);
    }
  });

  it('a voice that cannot stand alone, chosen for speech, brings its text side: it reads only its own translation', () => {
    const chosen = chooseNotAlone(soniox, 'speech', 'kizunaai_soniox');
    expect(chosen).toEqual({ lineUp: kizuna, moved: ['transcription', 'translation'] });
    expect(isRefusal(compose(chosen.lineUp, notAlone))).toBe(false);
    // The released voices that read only their own text: OpenAI Realtime's, Doubao AST 2.0's, Qwen's.
    for (const id of ['openai', 'volcengine_ast2', 'qwen_livetranslate', 'kizunaai_qwen']) {
      const all = { transcription: id, translation: id, speech: id, summarisation: null };
      expect(choose(soniox, 'speech', id), id).toEqual({ lineUp: all, moved: ['transcription', 'translation'] });
      // And another voice under it leaves its text where it is, and runs.
      const edge = choose(all, 'speech', 'edge');
      expect(edge, id).toEqual({ lineUp: { ...all, speech: 'edge' }, moved: [] });
      expect(isRefusal(compose(edge.lineUp, input)), id).toBe(false);
    }
  });

  it('a refusal of another kind makes nothing follow, and neither does a default voice that would still be refused', () => {
    // A catalog in which own-key Soniox takes no other voice: Kizuna AI's voice, offered alone, would follow it.
    const noVoice = allCaps().map((c) => (c.id === 'soniox' ? { ...c, takesVoice: false } : c));
    expect(chooseWith(kizuna, 'transcription', 'soniox', { ...input, catalog: noVoice }).followed).toEqual({ stage: 'speech', from: 'kizunaai_soniox', to: 'soniox' });
    // No provider is offered: the composer says so before it looks at the voice.
    const none = { ...choiceInput([], {}), catalog: noVoice };
    expect(compose({ ...soniox, speech: 'kizunaai_soniox' }, none)).toMatchObject({ refused: 'lineup_not_offered' });
    expect(chooseWith(kizuna, 'transcription', 'soniox', none)).toEqual({ lineUp: { ...soniox, speech: 'kizunaai_soniox' }, moved: ['translation'] });
    // Soniox is not offered, so its default voice would not run either: the choice is kept as made.
    const withoutSoniox = { ...choiceInput(RELEASED.filter((p) => p.id !== 'soniox'), {}), catalog: noVoice };
    expect(chooseWith(kizuna, 'transcription', 'soniox', withoutSoniox)).toEqual({ lineUp: { ...soniox, speech: 'kizunaai_soniox' }, moved: ['translation'] });
  });

  it('the two hosted providers are separate choices', () => {
    // Soniox's own-key voice reads Kizuna AI's Qwen.
    expect(choose(soniox, 'transcription', 'kizunaai_qwen').lineUp).toMatchObject({ transcription: 'kizunaai_qwen', translation: 'kizunaai_qwen', speech: 'soniox' });
    expect(choose(kizuna, 'speech', 'kizunaai_qwen').lineUp).toMatchObject({ transcription: 'kizunaai_qwen', translation: 'kizunaai_qwen', speech: 'kizunaai_qwen' });
    expect(choose(kizuna, 'transcription', 'kizunaai_qwen').lineUp).toMatchObject({ transcription: 'kizunaai_qwen', translation: 'kizunaai_qwen', speech: 'kizunaai_qwen' });
    const qwen = { transcription: 'kizunaai_qwen', translation: 'kizunaai_qwen', speech: 'kizunaai_qwen', summarisation: null };
    expect(choose(qwen, 'speech', 'kizunaai_soniox').lineUp).toEqual(kizuna);
  });
  it('only the notes can be switched off', () => { expect(() => choose(soniox, 'speech', null)).toThrow(); expect(choose(soniox, 'summarisation', null).lineUp.summarisation).toBeNull(); });
  it('refuses an option that does not serve the stage', () => { expect(() => choose(soniox, 'transcription', 'edge')).toThrow(); });

  // Every line-up of the catalog, every stage, every choice: about two seconds on a fast machine, more on a shared CI
  // runner, where the 5-second default ran out once the text-model providers joined the catalog.
  const EXHAUSTIVE_TIMEOUT_MS = 30_000;

  // Under the app's catalog, and under one in which Kizuna AI's Soniox voice is not offered alone.
  it.each([
    // A voice that is not offered alone goes with its text side, and a text side that takes no other voice holds all
    // three stages jointly: a voice follows by the composer's refusal only out of a stored line-up that put such a voice
    // beside another host's text.
    ["the app's catalog: only out of a stored lone voice", input, ['lineup_voice_not_alone']],
    // A voice that is not offered alone also follows a text side chosen beside it.
    ['a voice not offered alone: it follows', notAlone, ['lineup_voice_not_alone']],
  ] as const)('for every line-up and every choice: the chosen stage and the stages that go with it are the choice, any other stage moves only when its provider lost a stage it needs, and speech alone may follow (%s)', (_name, input, expected) => {
    const choose = (lineUp: LineUp, stage: RunStage, id: string) => chooseWith(lineUp, stage, id, input);
    const reasons = new Set<string>();
    for (const from of everyLineUp()) for (const stage of RUN_STAGES) for (const c of allCaps()) {
      if (!c.stages.includes(stage)) continue;
      const label = JSON.stringify({ from, stage, id: c.id });
      const { lineUp, moved, followed } = choose(from, stage, c.id);
      const catalogOf = (id: string) => (input.catalog ?? allCaps()).find((x) => x.id === id) ?? caps(id)!;
      // What an option holds with a stage: the stages that go with it, and for a voice not offered alone all it serves.
      const needs = (o: ReturnType<typeof catalogOf>, s: RunStage) => (s === 'speech' && !o.voiceAlone ? o.stages : goesWith(o, s));
      const group = needs(catalogOf(c.id), stage);
      const defaults = hostDefaults(c.host);
      // The line-up by the rule of the stages that go together alone.
      const byJoint = { ...from };
      let expectedFollow: { stage: 'speech'; from: string; to: string } | undefined;
      for (const s of RUN_STAGES) {
        if (group.includes(s)) { byJoint[s] = c.id; continue; }
        const option = catalogOf(from[s]!);
        const lost = (stages: readonly RunStage[]) => stages.some((t) => group.includes(t) && from[t] === from[s]);
        if (!lost(needs(option, s))) continue;
        byJoint[s] = defaults[s];
        // A voice that reads only its own text goes with it, and the result says so; a joint group goes whole, unsaid.
        if (s === 'speech' && !lost(goesWith(option, s)) && defaults.speech !== from.speech) expectedFollow = { stage: 'speech', from: from.speech!, to: defaults.speech! };
      }
      // A transcription that stands alone (Soniox's) stays when another option is chosen to translate it; one held
      // jointly with the translation (an end-to-end provider's) goes with it.
      if (stage === 'translation' && !group.includes('transcription') && !goesWith(catalogOf(from.transcription!), 'transcription').includes('translation')) {
        expect(lineUp.transcription, label).toBe(from.transcription);
      }
      // A voice left beside a text side chosen that it cannot run beside follows to the chosen host's voice, when that runs.
      let expected: LineUp = byJoint;
      const first = compose(byJoint, input);
      if (stage !== 'speech' && defaults.speech !== byJoint.speech && isRefusal(first) && ['lineup_voice_not_alone', 'lineup_voice_not_taken'].includes(first.refused)
        && !isRefusal(compose({ ...byJoint, speech: defaults.speech }, input))) {
        reasons.add(first.refused);
        expected = { ...byJoint, speech: defaults.speech };
        expectedFollow = { stage: 'speech', from: byJoint.speech!, to: defaults.speech! };
      }
      // Two managed providers never run together: the other one's stages go to the chosen host's defaults.
      if (c.account === 'kizuna') {
        const replaced = { ...expected };
        for (const s of RUN_STAGES) if (expected[s] !== c.id && catalogOf(expected[s]!).account === 'kizuna') replaced[s] = defaults[s];
        expected = replaced;
      }
      expect(lineUp, label).toEqual(expected);
      expect(followed, label).toEqual(expectedFollow);
      expect(moved, label).toEqual(RUN_STAGES.filter((s) => s !== stage && lineUp[s] !== from[s]));
      expect(lineUp.summarisation, label).toBe(from.summarisation);
    }
    expect([...reasons]).toEqual(expected);
  }, EXHAUSTIVE_TIMEOUT_MS);
  it('every line-up a user can reach by choosing, from any host\'s defaults, runs or is refused for how it is put together', () => {
    const key = (l: LineUp) => RUN_STAGES.map((s) => l[s]).join('|');
    const seen = new Map<string, LineUp>();
    const queue: LineUp[] = [...new Set(allCaps().map((c) => c.host))].map((host) => ({ ...hostDefaults(host), summarisation: null }));
    for (const start of queue) seen.set(key(start), start);
    while (queue.length > 0) {
      const from = queue.pop()!;
      for (const stage of RUN_STAGES) for (const c of allCaps()) {
        if (!c.stages.includes(stage)) continue;
        const { lineUp } = choose(from, stage, c.id);
        if (!seen.has(key(lineUp))) { seen.set(key(lineUp), lineUp); queue.push(lineUp); }
      }
    }
    const refusals = new Set<string>();
    const separate: string[] = [];
    for (const lineUp of seen.values()) {
      const plan = compose(lineUp, input);
      if (isRefusal(plan)) refusals.add(plan.refused);
      else if (plan.byStage.transcription !== plan.byStage.translation) separate.push(`${lineUp.transcription}>${lineUp.translation}`);
    }
    // None is refused: a choice moves what has to move with it, and every released host has a unit for each way
    // its stages can be left to it. What a reachable line-up can still be refused for needs the run's pair and
    // legs (`checkPlan`): `lineup_source_not_fixed`, `lineup_pair_not_translated`, `lineup_face_to_face_apart`
    // and `lineup_language_not_spoken`.
    expect([...refusals].sort()).toEqual(REACHABLE_REFUSALS);
    // The line-ups whose transcription and translation are apart: Soniox, either one, under Bing or this device, and this device's under Bing; and
    // Soniox, either one, or this device, under a text model. Local Native (#578 ruling 17): its recognition under
    // Bing, this device or a text model, and its translation under Soniox, either one, or this device.
    const textModels = ['openai_text', 'gemini_text', 'openai_compatible'];
    expect([...new Set(separate)].sort()).toEqual([
      'kizunaai_soniox>bing', 'kizunaai_soniox>local_inference', 'soniox>bing', 'soniox>local_inference', 'local_inference>bing',
      ...['kizunaai_soniox', 'soniox', 'local_inference'].flatMap((heard) => textModels.map((model) => `${heard}>${model}`)),
      'local_native>bing', 'local_native>local_inference', ...textModels.map((model) => `local_native>${model}`),
      'kizunaai_soniox>local_native', 'soniox>local_native', 'local_inference>local_native',
    ].sort());
  });
});
