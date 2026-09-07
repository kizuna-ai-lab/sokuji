import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * How a worker asks a chat template to disable thinking.
 *
 * `apply_chat_template` destructures `tokenizer_kwargs` out of its options and
 * forwards it to the TOKENIZER; only the remaining `...kwargs` are spread into
 * the Jinja render context. So `{ tokenizer_kwargs: { enable_thinking: false } }`
 * never reaches the template — it is inert, and silently so: no error, no
 * warning, and for Qwen3.5 no visible difference either, because that template
 * already suppresses thinking when the variable is undefined.
 *
 * A source scan rather than a unit test, because the mistake is in the SHAPE of
 * a call into a third-party API. There is nothing to extract and no worker
 * harness in this repo; what can be checked is that no worker writes the
 * ineffective form again.
 */

const WORKERS_DIR = join(__dirname);
const QWEN35 = join(WORKERS_DIR, 'qwen35-translation.worker.ts');

describe('disabling thinking reaches the chat template', () => {
  it('never nests enable_thinking under tokenizer_kwargs', () => {
    const source = readFileSync(QWEN35, 'utf8');
    expect(source).not.toMatch(/tokenizer_kwargs:\s*\{[^}]*enable_thinking/);
  });

  it('passes enable_thinking at the top level of apply_chat_template', () => {
    const source = readFileSync(QWEN35, 'utf8');
    const call = source.match(/apply_chat_template\([\s\S]*?\n    \}\);/);
    expect(call).not.toBeNull();
    expect(call![0]).toMatch(/^\s*enable_thinking:\s*false,\s*$/m);
  });

  // `/no_think` is Qwen3's soft switch, trained into the model. The Qwen3.5
  // chat template does not contain the string, so appending it only spends
  // prompt tokens — and prefill is where this model's time goes.
  it('does not append /no_think for Qwen3.5', () => {
    expect(readFileSync(QWEN35, 'utf8')).not.toMatch(/`\$\{[\w.]+\} \/no_think`/);
  });

  it('still appends /no_think for the plain Qwen3 worker, which does understand it', () => {
    const source = readFileSync(join(WORKERS_DIR, 'qwen-translation.worker.ts'), 'utf8');
    expect(source).toMatch(/\/no_think/);
  });
});
