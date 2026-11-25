/**
 * The three prompt shapes (port of translate_backend.py's strategies), chosen by the resolved card's prompt family:
 *
 * - Qwen 2.5 / 3 / 3.5: system + user chat; thinking is switched off with an empty <think> block as the assistant's
 *   prefill (disableThinking), and plain Qwen3 also gets "/no_think" on the system prompt (appendNoThink).
 * - HY-MT2 / HY-MT1.5: one user turn, no prefill.
 * - TranslateGemma: its chat template cannot be rendered by the library's formatter, so the prompt its template
 *   would produce is rendered here and sent through complete().
 */
import type { PlanConfig } from '../planner';

export type PromptConfig = Pick<PlanConfig, 'disableThinking' | 'appendNoThink'>;
export interface ChatMessage { role: string; content: string }
export type Built =
  | { mode: 'chat'; payload: ChatMessage[]; prefill: string | null }
  | { mode: 'complete'; payload: string; prefill: null };

export interface Strategy {
  readonly maxTokens: number;
  build(text: string, systemPrompt: string, src: string, tgt: string, wrap: boolean, config: PromptConfig): Built;
}

const TRANSCRIPT_TAG = /<\/?transcript>/gi;

export function defaultPrompt(src: string, tgt: string): string {
  const s = src || 'the source language';
  const t = tgt || 'the target language';
  return `You are a translator. Translate the text from ${s} to ${t}. Output only the translation, no explanations, no refusal.`;
}

/** Drops a <think>…</think> block, then stray <transcript> tags small models echo back. */
export function cleanOutput(text: string): string {
  const end = text.indexOf('</think>');
  const out = end === -1 ? text : text.slice(end + '</think>'.length);
  return pyStrip(out.replace(TRANSCRIPT_TAG, ''));
}

/** Python's str.isspace() set (no U+FEFF, which JavaScript's \s includes). */
const PY_SPACE = '[\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const PY_STRIP = new RegExp(`^${PY_SPACE}+|${PY_SPACE}+$`, 'g');

/** Python's str.strip(). */
export function pyStrip(s: string): string {
  return s.replace(PY_STRIP, '');
}

function hunyuanPrompt(tgt: string): string {
  const t = tgt || 'the target language';
  // HY-MT2's documented English instruction; the model detects the source itself.
  return `Translate the following text into ${t}. Note that you should only output the translated result without any additional explanation: `;
}

/**
 * BCP-47 code → the English name TranslateGemma's own template renders, for the 54 codes the language picker sends
 * (src/utils/languages.ts). The renderer sends codes ('ja', 'en'), never names.
 */
export const GEMMA_LANG_NAME: Readonly<Record<string, string>> = {
  af: 'Afrikaans', ar: 'Arabic', bg: 'Bulgarian', bn: 'Bengali', ca: 'Catalan',
  cs: 'Czech', da: 'Danish', de: 'German', el: 'Greek', en: 'English',
  es: 'Spanish', et: 'Estonian', fa: 'Persian', fi: 'Finnish', fr: 'French',
  gu: 'Gujarati', he: 'Hebrew', hi: 'Hindi', hr: 'Croatian', hu: 'Hungarian',
  id: 'Indonesian', is: 'Icelandic', it: 'Italian', ja: 'Japanese',
  kn: 'Kannada', ko: 'Korean', lt: 'Lithuanian', lv: 'Latvian', ml: 'Malayalam',
  mr: 'Marathi', mt: 'Maltese', nl: 'Dutch', no: 'Norwegian', pa: 'Punjabi',
  pl: 'Polish', pt: 'Portuguese', ro: 'Romanian', ru: 'Russian', sk: 'Slovak',
  sl: 'Slovenian', sr: 'Serbian', sv: 'Swedish', sw: 'Swahili', ta: 'Tamil',
  te: 'Telugu', th: 'Thai', tl: 'Tagalog', tr: 'Turkish', uk: 'Ukrainian',
  ur: 'Urdu', vi: 'Vietnamese', xh: 'Xhosa', zh: 'Chinese', zu: 'Zulu',
};

/** 'en' → 'English'; an unknown code passes through unchanged. */
const gemmaName = (code: string) => (Object.hasOwn(GEMMA_LANG_NAME, code) ? GEMMA_LANG_NAME[code] : code);

export class QwenStrategy implements Strategy {
  readonly maxTokens = 512;
  build(text: string, systemPrompt: string, src: string, tgt: string, wrap: boolean, config: PromptConfig): Built {
    let sys = systemPrompt || defaultPrompt(src, tgt);
    if (config.appendNoThink) sys = `${sys} /no_think`;
    const user = wrap ? `<transcript>${text}</transcript>` : text;
    return { mode: 'chat', payload: [{ role: 'system', content: sys }, { role: 'user', content: user }], prefill: config.disableThinking ? '<think>\n\n</think>\n\n' : null };
  }
}

export class HunyuanStrategy implements Strategy {
  readonly maxTokens = 512;
  build(text: string, systemPrompt: string, _src: string, tgt: string, wrap: boolean): Built {
    const instr = systemPrompt || hunyuanPrompt(tgt);
    const body = wrap ? `<transcript>${text}</transcript>` : text;
    return { mode: 'chat', payload: [{ role: 'user', content: `${instr}${body}` }], prefill: null };
  }
}

export class GemmaStrategy implements Strategy {
  readonly maxTokens = 256;
  /**
   * `wrap` is deliberately ignored: the system prompt (the only text that explains <transcript> tags) is dropped
   * because the upstream template refuses one, and an unexplained tag gets translated as content. Upstream never wraps.
   */
  build(text: string, _systemPrompt: string, src: string, tgt: string): Built {
    return { mode: 'complete', payload: this.renderPrompt(text, src, tgt), prefill: null };
  }

  renderPrompt(text: string, src: string, tgt: string): string {
    const sName = src ? gemmaName(src) : 'the source language';
    const tName = tgt ? gemmaName(tgt) : 'the target language';
    // Upstream renders "Name (code)"; only when a real name was resolved (no "()" and no "xx (xx)").
    const sLabel = src && sName !== src ? `${sName} (${src})` : sName;
    const tLabel = tgt && tName !== tgt ? `${tName} (${tgt})` : tName;
    return `<start_of_turn>user\nYou are a professional ${sLabel} to ${tLabel} translator. Your goal is to accurately convey the meaning and nuances of the original `
      + `${sName} text while adhering to ${tName} grammar, vocabulary, and cultural sensitivities.\n`
      + `Produce only the ${tName} translation, without any additional explanations or commentary. `
      + `Please translate the following ${sName} text into ${tName}:\n\n\n`
      + `${pyStrip(text)}<end_of_turn>\n<start_of_turn>model\n`;    // upstream: content["text"] | trim
  }
}

export const STRATEGIES: Readonly<Record<string, Strategy>> = { qwen: new QwenStrategy(), hunyuan: new HunyuanStrategy(), gemma: new GemmaStrategy() };

/** A self-rendered chatml prompt for a GGUF whose chat template the library's formatter does not know. */
export function chatmlFallback(messages: readonly ChatMessage[], prefill: string | null): string {
  let rendered = messages.map((m) => `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`).join('');
  rendered += '<|im_start|>assistant\n';
  if (prefill) rendered += prefill;
  return rendered;
}
