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

  it("refuses a direction its mode does not run — Korean speaks nowhere, but translates to text — as a guard", () => {
    const korean: SessionContext = { direction: { source: 'ko', target: 'zh' }, speech: true, turns: 'auto' };
    expect(buildAst2(korean, AST2_DEFAULTS, SHARED)).toEqual({ refused: 'Doubao AST 2.0 does not speak ko → zh.' });
    expect(buildAst2({ direction: { source: 'ja', target: 'de' }, speech: false, turns: 'auto' }, AST2_DEFAULTS, SHARED)).toEqual({ refused: 'Doubao AST 2.0 does not translate ja → de.' });
    expect(build({}, { ...korean, speech: false })).toEqual({ mode: 's2t', sourceLanguage: 'ko', targetLanguage: 'zh' });
    expect(build({}, { direction: { source: 'yue', target: 'en' }, speech: false, turns: 'auto' })).toMatchObject({ mode: 's2t', sourceLanguage: 'yue-CN' });
    expect(build({}, { direction: { source: 'zh+en', target: 'zh+en' }, speech: true, turns: 'manual' })).toMatchObject({ mode: 's2s', sourceLanguage: 'zhen', targetLanguage: 'zhen' });
  });

  it('describes no model (choice 7)', () => {
    expect(describeAst2(build())).toEqual({});
  });
});
