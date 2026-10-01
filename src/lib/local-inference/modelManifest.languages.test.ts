import { describe, expect, it } from 'vitest';
import { getLocalInferenceLanguages, getLocalInferenceTargetLanguages } from './modelManifest';
import { parseCode } from '../language/code';

const SNAPSHOT = ["af","am","ar","az","bg","bn","bs","ca","cs","cy","da","de","el","en","es","et","fa","fi","fil","fr","gl","gu","he","hi","hr","hu","id","is","it","ja","jv","ka","kk","km","kn","ko","lb","lo","lt","lv","mk","ml","mn","mr","ms","mt","my","ne","nl","no","pl","ps","pt","ro","ru","si","sk","sl","so","sq","sr","su","sv","sw","ta","te","th","tr","uk","ur","uz","vi","yue","zh"];

const values = () => getLocalInferenceLanguages().map((o) => o.value);

describe('the Local Inference language list (ASR ∩ TTS)', () => {
  it('is exactly the 74 snapshot codes', () => {
    expect([...values()].sort()).toEqual([...SNAPSHOT].sort());
  });

  it('targets are the same list without the source', () => {
    expect(getLocalInferenceTargetLanguages('ja').map((o) => o.value).sort())
      .toEqual(SNAPSHOT.filter((c) => c !== 'ja').sort());
  });

  it('Omnilingual contributes nothing; ASR-only and TTS-only codes are absent', () => {
    expect(values()).not.toContain('xh');
    expect(values()).not.toContain('pa');
    expect(values()).not.toContain('zu');
  });

  it('keeps Chinese as one zh and Cantonese as yue', () => {
    expect(values()).toContain('zh');
    expect(values()).toContain('yue');
    expect(values()).not.toContain('zh-Hans');
    expect(values()).not.toContain('zh-Hant');
  });

  it('offers app codes only', () => {
    for (const v of values()) expect(parseCode(v), v).not.toBeNull();
  });
});
