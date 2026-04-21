/// <reference lib="webworker" />
// Thin worker wrapper around BingTranslatorClient. Mirrors the message protocol
// used by the other translation workers in this directory, with extra fields
// for Bing-specific diagnostics (detectedLanguage, usedLLM).

import {
  BingTranslatorClient,
  BingTokenFetchError,
  BingUnsupportedLanguageError,
  BingTranslateError,
} from '../../bing-translator';

type InMessage =
  | { type: 'init'; sourceLang: string; targetLang: string }
  | { type: 'translate'; id: string; text: string; systemPrompt?: string; wrapTranscript?: boolean }
  | { type: 'dispose' };

// OutMessage mirrors the protocol consumed by TranslationEngine (main thread):
//   - 'ready'    → { type, loadTimeMs, device }
//   - 'result'   → { type, id, sourceText, translatedText, inferenceTimeMs, [systemPrompt] }
//   - 'error'    → { type, [id], error }
//   - 'disposed' → { type }
// Extra Bing-specific fields (detectedLanguage, usedLLM) are appended to 'result'
// and are ignored by TranslationEngine (it reads only the standard fields).
type OutMessage =
  | { type: 'ready'; device: string; loadTimeMs: number }
  | {
      type: 'result';
      id: string;
      sourceText: string;
      translatedText: string;
      inferenceTimeMs: number;
      detectedLanguage?: { language: string; score: number };
      usedLLM?: boolean;
    }
  | { type: 'error'; id?: string; error: string }
  | { type: 'disposed' };

let client: BingTranslatorClient | null = null;
let sourceLang = '';
let targetLang = '';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: OutMessage) {
  ctx.postMessage(msg);
}

ctx.onmessage = async (event: MessageEvent<InMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init': {
      const start = performance.now();
      sourceLang = msg.sourceLang;
      targetLang = msg.targetLang;
      client = new BingTranslatorClient();
      post({ type: 'ready', device: 'cloud', loadTimeMs: performance.now() - start });
      break;
    }

    case 'translate': {
      if (!client) {
        post({
          type: 'error',
          id: msg.id,
          error: 'worker not initialized',
        });
        return;
      }
      try {
        const result = await client.translate(msg.text, sourceLang, targetLang);
        post({
          type: 'result',
          id: msg.id,
          sourceText: msg.text,
          translatedText: result.translatedText,
          inferenceTimeMs: result.inferenceTimeMs,
          detectedLanguage: result.detectedLanguage,
          usedLLM: result.usedLLM,
        });
      } catch (err) {
        // Prefix the error message with a bracket-tag so the main thread can
        // classify the failure without extending the worker-protocol shape.
        // Task 10 (LocalInferenceClient) reads the prefix to pick a user-facing
        // message; other translation workers emit untagged messages and fall
        // through to the raw text.
        const errorType = classifyError(err);
        const raw = err instanceof Error ? err.message : String(err);
        post({
          type: 'error',
          id: msg.id,
          error: `[bing:${errorType}] ${raw}`,
        });
      }
      break;
    }

    case 'dispose': {
      client = null;
      post({ type: 'disposed' });
      break;
    }
  }
};

function classifyError(err: unknown): 'token' | 'unsupported' | 'network' | 'unknown' {
  if (err instanceof BingTokenFetchError) return 'token';
  if (err instanceof BingUnsupportedLanguageError) return 'unsupported';
  if (err instanceof BingTranslateError) return 'network';
  return 'unknown';
}

