/**
 * Doubao AST 2.0's `C`, `build` and `describe` (survey §2.7). One builder for
 * both legs: the participant is the same call on the reversed direction,
 * and it speaks when its switch is on (ruling 4) — `context.speech` says so.
 */
import type { SessionContext } from '../../lib/contract/adapter';
import type { ProviderRefusal, SharedSettings } from '../../lib/provider/types';
import { resourceOf } from './catalog';
import { ast2Languages, ast2Offers, type Ast2Settings } from './settings';
import { CLONE, effectiveVoice } from './voice';

/** The console libraries a session names (`ReqParams.corpus`), the protobuf's camelCase names. */
export interface Ast2Corpus {
  boostingTableId?: string;
  regexCorrectTableId?: string;
  glossaryTableId?: string;
}

export interface Ast2Config {
  /** Speech to speech, or to text only (`context.speech`). */
  mode: 's2s' | 's2t';
  sourceLanguage: string;
  targetLanguage: string;
  /** Absent when no library id is set. */
  corpus?: Ast2Corpus;
  /** A fixed voice (`speaker_id`) and the TTS resource it runs on (`tts_resource_id`), on a speaking leg only (#577); absent, the server clones the speaker. */
  voice?: Ast2VoiceConfig;
}

export interface Ast2VoiceConfig {
  speakerId: string;
  ttsResourceId: string;
}

/**
 * The library ids a user set, trimmed; absent when none is (the old
 * `buildCorpusFromConfig`, `VolcengineAST2Client.ts:74-85`). Invalid ids
 * are silently ignored by the server, as the settings' footer says.
 */
export function buildCorpus(s: Pick<Ast2Settings, 'hotWordTableId' | 'replacementTableId' | 'glossaryTableId'>): Ast2Corpus | undefined {
  const corpus: Ast2Corpus = {};
  const hot = s.hotWordTableId?.trim();
  const replacement = s.replacementTableId?.trim();
  const glossary = s.glossaryTableId?.trim();
  if (hot) corpus.boostingTableId = hot;
  if (replacement) corpus.regexCorrectTableId = replacement;
  if (glossary) corpus.glossaryTableId = glossary;
  return Object.keys(corpus).length > 0 ? corpus : undefined;
}

export function buildAst2(context: SessionContext, s: Ast2Settings, _shared: SharedSettings): Ast2Config | ProviderRefusal {
  const { source, target } = context.direction;
  // A guard: the provider store keeps the pair within what the run's context offers (choice 1), so no surface hands one it cannot run.
  if (!ast2Offers(context.direction, s, { speech: context.speech })) {
    return { refused: `Doubao AST 2.0 does not ${context.speech ? 'speak' : 'translate'} ${source} → ${target}.` };
  }
  const corpus = buildCorpus(s);
  // The same libraries on both legs (parity): the build cannot tell the legs of a `zh+en` pair apart (choice 6).
  const wire = ast2Languages.wire;
  // A speaking leg's voice for its own direction (#577 catalog §2.5); a text-only leg has none, and cloning is no field at all.
  const voice = context.speech ? effectiveVoice(context.direction, s) : undefined;
  if (context.speech && voice === undefined) return { refused: `Doubao AST 2.0 has no voice that speaks ${target}.` };
  const ttsResourceId = voice !== undefined && voice !== CLONE ? resourceOf(voice) : undefined;
  return {
    mode: context.speech ? 's2s' : 's2t',
    sourceLanguage: wire.toWire(source),
    targetLanguage: wire.toWire(target),
    ...(corpus ? { corpus } : {}),
    ...(voice && ttsResourceId ? { voice: { speakerId: voice, ttsResourceId } } : {}),
  };
}

/** No model to name: the old start reported none for AST2 (choice 7). */
export function describeAst2(_c: Ast2Config): Record<string, never> {
  return {};
}
