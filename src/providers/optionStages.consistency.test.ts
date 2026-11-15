// Each provider's `optionStages` (mock v19) says which stage sets its options act on, so the line-up page knows which
// stage cards have options without drawing them. It must name exactly the sets its `Settings` source wraps in
// `StagePart` (and, for the local engine, its slots): a part the declaration misses would never get a card.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_STAGES, SP, TL, TR, TR_TL } from '../lib/lineup/types';
import { sonioxProvider } from './soniox/provider';
import { kizunaSonioxProvider } from './soniox/kizuna';
import { geminiProvider } from './gemini/provider';
import { openaiProvider } from './openai/provider';
import { openaiTranslateProvider } from './openai_translate/provider';
import { openaiLiveProvider } from './openai_live/provider';
import { palabraProvider } from './palabraai/provider';
import { volcengineAst2Provider as ast2Provider } from './volcengine_ast2/provider';
import { qwenLiveTranslateProvider } from './qwen_livetranslate/provider';
import { kizunaQwenProvider } from './qwen_livetranslate/kizuna';
import { localInferenceProvider } from './localInference/provider';

const SETS = { ALL_STAGES, TR, TL, SP, TR_TL } as const;
const nameOf = (set: unknown) => Object.entries(SETS).find(([, v]) => v === set)?.[0] ?? '?';
const src = (path: string) => readFileSync(join(process.cwd(), 'src', path), 'utf8');
const partsIn = (source: string) => [...new Set([...source.matchAll(/<StagePart stages=\{(\w+)\}>/g)].map((m) => m[1]))].sort();
const qwen = src('providers/qwen_livetranslate/QwenSettings.tsx');
const qwenShared = qwen.slice(0, qwen.indexOf('export function KizunaQwenSettingsView'));

const CASES: Array<[string, { optionStages?: readonly (readonly unknown[])[] }, string]> = [
  ['soniox', sonioxProvider, src('providers/soniox/SonioxSettings.tsx')],
  ['kizunaai_soniox', kizunaSonioxProvider, src('providers/soniox/SonioxSettings.tsx')],
  ['gemini', geminiProvider, src('providers/gemini/GeminiSettings.tsx')],
  ['openai', openaiProvider, src('providers/openai/RealtimeSettings.tsx')],
  ['openai_translate', openaiTranslateProvider, src('providers/openai_translate/TranslateSettings.tsx')],
  ['openai_live', openaiLiveProvider, src('providers/openai_live/LiveSettings.tsx')],
  ['palabraai', palabraProvider, src('providers/palabraai/PalabraSettings.tsx')],
  ['volcengine_ast2', ast2Provider, src('providers/volcengine_ast2/Ast2Settings.tsx')],
  ['qwen_livetranslate', qwenLiveTranslateProvider, qwenShared],
  ['kizunaai_qwen', kizunaQwenProvider, qwen],
  // The local engine's slots are transcription, translation and speech; its settings add to them.
  ['local_inference', localInferenceProvider, src('providers/localInference/LocalInferenceSettings.tsx') + '<StagePart stages={TR}><StagePart stages={TL}><StagePart stages={SP}>'],
];

describe('optionStages', () => {
  it.each(CASES)('%s declares exactly the stage sets its settings use', (_id, provider, source) => {
    expect((provider.optionStages ?? []).map(nameOf).sort()).toEqual(partsIn(source));
  });
});
