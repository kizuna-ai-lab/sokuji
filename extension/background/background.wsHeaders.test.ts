// The background worker cannot be booted in vitest (it imports a build-generated
// table and registers chrome listeners at load): its wiring of the generic
// upgrade header rules is asserted on its source text, as Electron's wiring
// tests do (Stage 2 OpenAI Live, choice 3).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const background = readFileSync(join(__dirname, 'background.js'), 'utf8');
const viteConfig = readFileSync(join(__dirname, '..', 'vite.config.ts'), 'utf8');

/** Index of `needle` in `text`; fails (rather than returning -1) when it is gone. */
function at(text: string, needle: string): number {
  const i = text.indexOf(needle);
  expect(i, `expected to find ${needle}`).toBeGreaterThan(-1);
  return i;
}

/** A function's source, to its closing brace at the start of a line. */
function fn(name: string): string {
  const rest = background.slice(at(background, `function ${name}(`));
  return rest.slice(0, at(rest, '\n}') + 2);
}

describe('the background worker: the generic upgrade header rules', () => {
  it('imports the pure rules, which the build copies beside it', () => {
    expect(background).toContain("import { buildRule, isExtensionPage, ruleIdsFor, ruleProblem, sweepIds } from './wsHeaderRule.js';");
    expect(viteConfig).toContain("{ src: 'background/wsHeaderRule.js', dest: '.' },");
  });

  it("answers WS_HEADERS_SET and WS_HEADERS_CLEAR only for the extension's own pages, checking the sender before anything", () => {
    const branch = background.slice(at(background, "if (message.type === 'WS_HEADERS_SET' || message.type === 'WS_HEADERS_CLEAR') {"));
    const check = at(branch, "if (!isExtensionPage(sender, chrome.runtime.id, chrome.runtime.getURL(''))) {");
    expect(check).toBeLessThan(at(branch, 'wsHeadersSet(message)'));
    expect(check).toBeLessThan(at(branch, 'wsHeadersClear(message)'));
    expect(branch.slice(check)).toContain("sendResponse({ success: false, error: 'Sender is not an extension page' });");
  });

  it('validates before the shared chain, chains every update on it, and never leaves it rejected', () => {
    const set = fn('wsHeadersSet');
    expect(at(set, 'ruleProblem(message)')).toBeLessThan(at(set, 'dnrUpdatePromise.then('));
    for (const name of ['wsHeadersSet', 'wsHeadersClear', 'wsHeadersSweep']) {
      const body = fn(name);
      expect(body, name).toContain('dnrUpdatePromise.then(');
      expect(body, name).toContain('dnrUpdatePromise = run.catch(() => {});');
    }
    expect(fn('wsHeadersSet')).toContain('removeRuleIds: [rule.id], addRules: [rule]');
    expect(fn('wsHeadersClear')).toContain('ruleIdsFor(');
    expect(fn('wsHeadersSweep')).toContain('sweepIds(');
  });

  it('sweeps the generic rules and the old Live rule when the browser or the extension starts, since dynamic rules outlive both (ruling 11)', () => {
    expect(background).toContain('chrome.runtime.onStartup.addListener(() => { void wsHeadersSweep(); });');
    expect(background).toContain('chrome.runtime.onInstalled.addListener(() => { void wsHeadersSweep(); });');
  });

  it("leaves the old OpenAI Live pair as it was: it goes with the old client", () => {
    expect(background).toContain("if (message.type === 'OPENAI_LIVE_SET_HEADERS') {");
    expect(background).toContain("if (message.type === 'OPENAI_LIVE_CLEAR_HEADERS') {");
    expect(background).toContain('const OPENAI_LIVE_DNR_RULE_ID = 4000;');
  });
});
