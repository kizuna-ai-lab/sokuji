// @vitest-environment node
/**
 * The prompt strategies (ported from sidecar/tests/test_translate_backend.py's pure cases) and the Python engine's own
 * prompts for every strategy, config, language pair and wrap (test/golden/prompts.json).
 */
import '../test/env';
import { describe, expect, it } from 'vitest';
import golden from '../test/golden/prompts.json';
import { GEMMA_LANG_NAME, GemmaStrategy, STRATEGIES, chatmlFallback, cleanOutput, defaultPrompt, pyStrip, type ChatMessage } from './strategies';

const CONFIGS = { plain: { disableThinking: false, appendNoThink: false }, no_thinking: { disableThinking: true, appendNoThink: true } } as const;

describe('prompts.json', () => {
  it('matches prompts.json', () => {
    const cases = golden.cases as Array<Record<string, any>>;
    expect(cases.length).toBe(231);
    for (const c of cases) {
      switch (c.fn) {
        case 'build': {
          const built = STRATEGIES[c.strategy].build(c.text, c.system_prompt, c.src, c.tgt, c.wrap, CONFIGS[c.config as keyof typeof CONFIGS]);
          expect([c.strategy, c.config, c.text, c.wrap, built]).toEqual([c.strategy, c.config, c.text, c.wrap, c.result]);
          break;
        }
        case 'max_tokens': expect([c.strategy, STRATEGIES[c.strategy].maxTokens]).toEqual([c.strategy, c.result]); break;
        case '_clean_output': expect([c.text, cleanOutput(c.text)]).toEqual([c.text, c.result]); break;
        case '_chatml_fallback': expect(chatmlFallback(c.messages as ChatMessage[], c.prefill)).toBe(c.result); break;
        case '_GEMMA_LANG_NAME': expect(GEMMA_LANG_NAME).toEqual(c.result); break;
        default: throw new Error(`unknown case ${c.fn}`);
      }
    }
  });
});

describe('the prompt helpers', () => {
  it('the default prompt names both languages and asks for the translation only', () => {
    const p = defaultPrompt('Japanese', 'English');
    expect(p).toContain('Japanese');
    expect(p).toContain('English');
    expect(p.toLowerCase()).toContain('only');
  });

  it('cleanOutput drops a think block', () => {
    expect(cleanOutput('<think>reasoning</think>  hello')).toBe('hello');
    expect(cleanOutput('plain')).toBe('plain');
  });

  it('cleanOutput strips transcript tags a small model echoes', () => {
    expect(cleanOutput('The weather today is nice.</transcript>')).toBe('The weather today is nice.');
    expect(cleanOutput('<transcript>hi</transcript>')).toBe('hi');
    expect(cleanOutput('<think>x</think> Hello</transcript>')).toBe('Hello');
  });

  it("strips Python's whitespace, not U+FEFF", () => {
    expect(pyStrip('　\x1c hi \x85 ')).toBe('hi');
    expect(pyStrip('﻿hi')).toBe('﻿hi');
  });
});

describe('TranslateGemma', () => {
  const g = new GemmaStrategy();

  it('a falsy source has no empty code', () => {
    const prompt = g.renderPrompt('hello', '', 'ja');
    expect(prompt).not.toContain('()');
    expect(prompt).toContain('the source language to Japanese (ja)');
  });

  it('renders names from the ISO codes the renderer sends', () => {
    const prompt = g.renderPrompt('hello', 'en', 'fr');
    expect(prompt).toContain('professional English (en) to French (fr) translator');
    expect(prompt).not.toContain('en (en)');
    expect(prompt).toContain('following English text into French');
  });

  it('knows the languages beyond the original twenty', () => {
    for (const [code, name] of [['sv', 'Swedish'], ['cs', 'Czech'], ['da', 'Danish']]) {
      expect(g.renderPrompt('hello', code, 'en')).toContain(`professional ${name} (${code}) to English (en) translator`);
    }
  });

  it('never wraps the input in transcript tags', () => {
    const built = g.build('hello', 'ignored-system-prompt', 'en', 'fr');
    expect(built.mode).toBe('complete');
    expect(String(built.payload)).not.toContain('<transcript>');
    expect(String(built.payload).endsWith('hello<end_of_turn>\n<start_of_turn>model\n')).toBe(true);
  });

  it('is verbatim the upstream template', () => {
    expect(g.renderPrompt('hello world', 'en', 'fr')).toBe(
      '<start_of_turn>user\n'
      + 'You are a professional English (en) to French (fr) translator. Your goal is to '
      + 'accurately convey the meaning and nuances of the original English text while '
      + 'adhering to French grammar, vocabulary, and cultural sensitivities.\n'
      + 'Produce only the French translation, without any additional explanations or '
      + 'commentary. Please translate the following English text into French:\n'
      + '\n\n'
      + 'hello world<end_of_turn>\n'
      + '<start_of_turn>model\n',
    );
  });

  it('trims the text as the upstream template does', () => {
    expect(g.renderPrompt('  hello  ', 'en', 'fr').endsWith('hello<end_of_turn>\n<start_of_turn>model\n')).toBe(true);
  });

  it("an object's own keys only: 'constructor' is not a language", () => {
    expect(g.renderPrompt('hi', 'constructor', 'en')).toContain('professional constructor to English (en)');
  });
});
