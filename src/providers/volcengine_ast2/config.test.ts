import { describe, it, expect } from 'vitest';
import type { SessionContext } from '../../lib/contract/adapter';
import type { SharedSettings } from '../../lib/provider/types';
import { buildAst2, buildCorpus, describeAst2, type Ast2Config } from './config';
import { AST2_DEFAULTS, type Ast2Settings } from './settings';

const SHARED: SharedSettings = {
  pauses: { sourceSeconds: 1, translationSeconds: 1 },
  reversed: (d) => d.source === 'en' && d.target === 'zh',
  segmentation: { mode: 'off', sentencesPerRow: 0 },
  models: [],
};
const SPEAKER: SessionContext = { direction: { source: 'zh', target: 'en' }, speech: true, turns: 'auto' };
const build = (patch: Partial<Ast2Settings> = {}, context = SPEAKER) => buildAst2(context, { ...AST2_DEFAULTS, ...patch }, SHARED) as Ast2Config;

it('sends Doubao its own codes', () => {
  const c = buildAst2({ direction: { source: 'zh+en', target: 'zh+en' }, speech: true, turns: 'auto' }, AST2_DEFAULTS, SHARED);
  expect(c).toMatchObject({ sourceLanguage: 'zhen', targetLanguage: 'zhen' });
  const d = buildAst2({ direction: { source: 'wuu', target: 'zh' }, speech: false, turns: 'auto' }, AST2_DEFAULTS, SHARED);
  expect(d).toMatchObject({ sourceLanguage: 'sh-CN', targetLanguage: 'zh' });
});

describe('buildCorpus — the old buildCorpusFromConfig cases (`VolcengineAST2Client.test.ts:19-79`)', () => {
  it('is absent when no id is set, or every id is blank', () => {
    expect(buildCorpus(AST2_DEFAULTS)).toBeUndefined();
    expect(buildCorpus({ hotWordTableId: '  ', replacementTableId: '', glossaryTableId: '\t' })).toBeUndefined();
  });

  it('carries only the ids that are set, trimmed, under the protobuf names', () => {
    expect(buildCorpus({ hotWordTableId: ' hot-1 ', replacementTableId: '', glossaryTableId: '' })).toEqual({ boostingTableId: 'hot-1' });
    expect(buildCorpus({ hotWordTableId: '', replacementTableId: 'rep-1', glossaryTableId: 'glo-1' })).toEqual({ regexCorrectTableId: 'rep-1', glossaryTableId: 'glo-1' });
    expect(buildCorpus({ hotWordTableId: 'a', replacementTableId: 'b', glossaryTableId: 'c' })).toEqual({ boostingTableId: 'a', regexCorrectTableId: 'b', glossaryTableId: 'c' });
  });
});

describe("Doubao AST 2.0's builder", () => {
  it('runs a speaking leg speech to speech and a silent one to text, in its direction', () => {
    expect(build()).toEqual({ mode: 's2s', sourceLanguage: 'zh', targetLanguage: 'en' });
    expect(build({}, { ...SPEAKER, speech: false })).toEqual({ mode: 's2t', sourceLanguage: 'zh', targetLanguage: 'en' });
  });

  it('names the libraries on both legs, the participant too (parity; choice 6)', () => {
    const libraries = { hotWordTableId: 'hot-1', glossaryTableId: 'glo-1' };
    expect(build(libraries).corpus).toEqual({ boostingTableId: 'hot-1', glossaryTableId: 'glo-1' });
    const participant: SessionContext = { direction: { source: 'en', target: 'zh' }, speech: true, turns: 'auto' };
    expect(build(libraries, participant)).toEqual({ mode: 's2s', sourceLanguage: 'en', targetLanguage: 'zh', corpus: { boostingTableId: 'hot-1', glossaryTableId: 'glo-1' } });
  });

  it('clones a pair cloning runs when no voice is chosen, naming no voice (#577 catalog §2.5)', () => {
    expect(build()).toEqual({ mode: 's2s', sourceLanguage: 'zh', targetLanguage: 'en' });
    expect(build({ voices: { en: 'clone' } })).toEqual({ mode: 's2s', sourceLanguage: 'zh', targetLanguage: 'en' });
  });

  it('speaks the voice chosen for the target, on the resource it runs on', () => {
    expect(build({ voices: { en: 'zh_male_jingqiangkanye_emo_mars_bigtts' } }).voice).toEqual({ speakerId: 'zh_male_jingqiangkanye_emo_mars_bigtts', ttsResourceId: 'seed-tts-1.0' });
    expect(build({ voices: { en: 'en_male_alex_uranus_bigtts' } }).voice).toEqual({ speakerId: 'en_male_alex_uranus_bigtts', ttsResourceId: 'seed-tts-2.0' });
  });

  it("speaks the target's first voice on a pair cloning does not run", () => {
    const at = (source: string, target: string): SessionContext => ({ direction: { source, target }, speech: true, turns: 'auto' });
    expect(build({}, at('ko', 'en'))).toMatchObject({ mode: 's2s', sourceLanguage: 'ko', voice: { speakerId: 'zh_female_vv_uranus_bigtts', ttsResourceId: 'seed-tts-2.0' } });
    expect(build({}, at('zh', 'ko')).voice).toEqual({ speakerId: 'ko_male_m03_uranus_bigtts', ttsResourceId: 'seed-tts-2.0' });
    expect(build({}, at('yue', 'zh'))).toMatchObject({ sourceLanguage: 'yue-CN', voice: { speakerId: 'zh_female_vv_uranus_bigtts' } });
    // A stored clone for English cannot run ko → en: the first voice, and the slot is left alone.
    expect(build({ voices: { en: 'clone' } }, at('ko', 'en')).voice?.speakerId).toBe('zh_female_vv_uranus_bigtts');
  });

  it('never sends a voice a refresh removed: the fallback runs instead (Review Focus)', () => {
    expect(build({ voices: { en: 'nope_bigtts' } })).not.toHaveProperty('voice');
  });

  it('names no voice for a leg that does not speak, whatever is chosen', () => {
    expect(build({ voices: { en: 'en_male_alex_uranus_bigtts' } }, { ...SPEAKER, speech: false })).toEqual({ mode: 's2t', sourceLanguage: 'zh', targetLanguage: 'en' });
  });

  it("speaks the participant leg's own target's voice (Review Focus)", () => {
    const voices = { en: 'en_male_alex_uranus_bigtts', zh: 'zh_male_jingqiangkanye_emo_mars_bigtts' };
    const participant: SessionContext = { direction: { source: 'en', target: 'zh' }, speech: true, turns: 'auto' };
    expect(build({ voices }).voice?.speakerId).toBe('en_male_alex_uranus_bigtts');
    expect(build({ voices }, participant).voice?.speakerId).toBe('zh_male_jingqiangkanye_emo_mars_bigtts');
  });

  it('refuses a direction its mode does not run, as a guard', () => {
    expect(buildAst2({ direction: { source: 'zh', target: 'ru' }, speech: true, turns: 'auto' }, AST2_DEFAULTS, SHARED)).toEqual({ refused: 'Doubao AST 2.0 does not speak zh → ru.' });
    expect(buildAst2({ direction: { source: 'ja', target: 'de' }, speech: false, turns: 'auto' }, AST2_DEFAULTS, SHARED)).toEqual({ refused: 'Doubao AST 2.0 does not translate ja → de.' });
    expect(build({}, { direction: { source: 'zh', target: 'ru' }, speech: false, turns: 'auto' })).toEqual({ mode: 's2t', sourceLanguage: 'zh', targetLanguage: 'ru' });
    expect(build({}, { direction: { source: 'zh+en', target: 'zh+en' }, speech: true, turns: 'manual' })).toEqual({ mode: 's2s', sourceLanguage: 'zhen', targetLanguage: 'zhen' });
  });

  it('describes no model (choice 7)', () => {
    expect(describeAst2(build())).toEqual({});
  });

  it('runs text mode with no voice when transcribing only', () => {
    const c = buildAst2({ direction: { source: 'zh', target: 'en' }, speech: true, translate: false, turns: 'auto' }, AST2_DEFAULTS, SHARED) as Ast2Config;
    expect(c).toMatchObject({ mode: 's2t', transcribeOnly: true });
    expect(c.voice).toBeUndefined();
  });
});
