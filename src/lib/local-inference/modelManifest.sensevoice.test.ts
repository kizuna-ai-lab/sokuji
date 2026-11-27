// 'SenseVoice (int8)' was ASLP-lab's Cantonese fine-tune of SenseVoice Small, offered for zh/en/ja/ko/yue: on Japanese
// it wrote Chinese characters and dropped the kana. It keeps its files and id, and is offered for Cantonese only.
import { describe, expect, it } from 'vitest';
import { getAsrModelsForLanguage, getManifestEntry } from './modelManifest';
import { resolveWasmDirection } from './selection/resolveWithStages';

const recognitionOnly = { transcription: 'local', translation: null, speech: null } as const;
const ctx = (downloaded: string[]) => ({
  modelStatuses: Object.fromEntries(downloaded.map((id) => [id, 'downloaded' as const])),
  webgpuAvailable: false,
  deviceFeatures: [],
});

describe('the Cantonese SenseVoice', () => {
  it('is named and offered as Cantonese, under the id its downloads are kept by', () => {
    const entry = getManifestEntry('sensevoice-int8');
    expect(entry).toMatchObject({ name: 'SenseVoice Cantonese (int8)', languages: ['yue'], cdnPath: 'wasm-sensevoice-int8' });
    expect(getAsrModelsForLanguage('yue').map((m) => m.id)).toContain('sensevoice-int8');
    for (const lang of ['ja', 'zh', 'en', 'ko']) expect(getAsrModelsForLanguage(lang).map((m) => m.id)).not.toContain('sensevoice-int8');
  });

  it('the multilingual SenseVoice Nano is still offered for Japanese', () => {
    expect(getManifestEntry('sensevoice-nano-int8')?.languages).toEqual(['zh', 'en', 'ja', 'ko', 'yue']);
  });

  it('a Japanese leg that was set to it: another downloaded model recognises, the choice is kept and the change noted', () => {
    const selections = { 'ja→en': { asr: { modelId: 'sensevoice-int8' } } };
    const r = resolveWasmDirection('ja', 'en', selections as never, ctx(['sensevoice-int8', 'sensevoice-nano-int8']), recognitionOnly);
    expect(r.asr).toMatchObject({ modelId: 'sensevoice-nano-int8', source: 'auto' });
    expect(r.notes).toEqual([{ direction: 'ja→en', stage: 'asr', from: 'sensevoice-int8', to: 'sensevoice-nano-int8', reason: 'lang-incompatible' }]);
    expect(r.prunes).toEqual([]);
  });

  it('a Japanese leg with no other model downloaded: nothing recognises, and that is noted', () => {
    const selections = { 'ja→en': { asr: { modelId: 'sensevoice-int8' } } };
    const r = resolveWasmDirection('ja', 'en', selections as never, ctx(['sensevoice-int8']), recognitionOnly);
    expect(r.asr).toBeNull();
    expect(r.notes).toEqual([{ direction: 'ja→en', stage: 'asr', from: 'sensevoice-int8', to: null, reason: 'lang-incompatible' }]);
  });

  it('a Cantonese leg set to it keeps it', () => {
    const selections = { 'yue→en': { asr: { modelId: 'sensevoice-int8' } } };
    const r = resolveWasmDirection('yue', 'en', selections as never, ctx(['sensevoice-int8', 'sensevoice-nano-int8']), recognitionOnly);
    expect(r.asr).toMatchObject({ modelId: 'sensevoice-int8', source: 'explicit' });
    expect(r.notes).toEqual([]);
  });
});
