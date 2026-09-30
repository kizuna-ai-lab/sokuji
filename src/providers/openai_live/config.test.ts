import { describe, it, expect } from 'vitest';
import type { SessionContext } from '../../lib/contract/adapter';
import { INSTRUCTIONS_TEMPLATE } from '../../lib/provider/instructions';
import { AUTO } from '../../lib/provider/languages';
import type { SharedSettings } from '../../lib/provider/types';
import { buildLive, describeLive } from './config';
import { LIVE_DEFAULTS } from './settings';

const SHARED: SharedSettings = {
  pauses: { sourceSeconds: 1.5, translationSeconds: 2 },
  reversed: (d) => d.source === 'zh_CN' && d.target === 'en',
  segmentation: { mode: 'pause', sentencesPerRow: 0 },
  models: [{ id: 'gpt-live-1' }],
};
const SPEAKER: SessionContext = { direction: { source: 'en', target: 'zh_CN' }, speech: true, turns: 'auto' };
const PARTICIPANT: SessionContext = { direction: { source: 'zh_CN', target: 'en' }, speech: false, turns: 'auto' };

describe("OpenAI Live's builder", () => {
  it("builds gpt-live-1 with this direction's prompt, the voice, both pauses and one sentence a segment by pause", () => {
    expect(buildLive(SPEAKER, { ...LIVE_DEFAULTS, voice: 'cedar' }, SHARED)).toEqual({
      model: 'gpt-live-1',
      instructions: INSTRUCTIONS_TEMPLATE.replace(/\{\{SOURCE_LANGUAGE\}\}/g, 'English').replace(/\{\{TARGET_LANGUAGE\}\}/g, 'Chinese (China)'),
      voice: 'cedar',
      silence: { sourceMs: 1500, translationMs: 2000, deferMidSentence: false },
      sentencesPerSegment: 1,
      transport: 'websocket',
    });
  });

  it("cuts every N sentences by sentence, N the display's own (ruling 4) — none at 0 — and one when the display cuts nothing", () => {
    const at = (segmentation: SharedSettings['segmentation']) => {
      const c = buildLive(SPEAKER, LIVE_DEFAULTS, { ...SHARED, segmentation });
      return 'refused' in c ? c : [c.sentencesPerSegment, c.silence.deferMidSentence];
    };
    expect(at({ mode: 'sentences', sentencesPerRow: 3 })).toEqual([3, true]);
    expect(at({ mode: 'sentences', sentencesPerRow: 0 })).toEqual([0, true]);
    expect(at({ mode: 'off', sentencesPerRow: 2 })).toEqual([1, false]);
  });

  it("gives the participant's direction Other's prompt in Advanced mode, and builds the same whether the leg speaks or not (ruling 1)", () => {
    const s = { ...LIVE_DEFAULTS, useTemplateMode: false, systemInstructions: 'Mine.', participantSystemInstructions: 'Theirs.' };
    const c = buildLive(PARTICIPANT, s, SHARED);
    expect(c).toMatchObject({ instructions: 'Theirs.' });
    expect(buildLive({ ...PARTICIPANT, speech: true }, s, SHARED)).toEqual(c);
  });

  it('names an Auto-detect source "the spoken language" in the template', () => {
    const c = buildLive({ ...SPEAKER, direction: { source: AUTO, target: 'ja' } }, LIVE_DEFAULTS, SHARED);
    expect('refused' in c ? c.refused : c.instructions).toContain('translate the spoken language → Japanese');
  });

  it('refuses a target outside the 55 in words, and asks for marin in place of a voice outside the 22', () => {
    expect(buildLive({ ...SPEAKER, direction: { source: 'en', target: 'yue' } }, LIVE_DEFAULTS, SHARED)).toEqual({ refused: 'OpenAI Live does not translate into yue.' });
    expect(buildLive(SPEAKER, { ...LIVE_DEFAULTS, voice: 'nova' }, SHARED)).toMatchObject({ voice: 'marin' });
  });

  it('describes one model for both sides: it hears as well as translates', () => {
    const c = buildLive(SPEAKER, LIVE_DEFAULTS, SHARED);
    if ('refused' in c) throw new Error(c.refused);
    expect(describeLive(c)).toEqual({ translationModel: 'gpt-live-1', asrModel: 'gpt-live-1' });
  });
});
