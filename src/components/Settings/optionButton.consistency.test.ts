/**
 * An `.option-button` is one of a row of choices, the chosen one drawn by its
 * `active` class. A screen reader hears which one is chosen only through
 * `aria-pressed`, so every option button states it, and states the very
 * condition its `active` class reads (review of #651).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

const SRC = resolve(__dirname, '../..');

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (entry.endsWith('.tsx') && !entry.endsWith('.test.tsx')) out.push(path);
  }
  return out;
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

interface OptionButton { at: string; active: string | null; pressed: string | null }

/** Each JSX element whose `className` names `option-button`: the condition its `active` reads and its `aria-pressed`, as written. */
function optionButtons(file: string): OptionButton[] {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: OptionButton[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
      const attr = (name: string) => attrs.find((a) => a.name.getText(sf) === name)?.initializer;
      const className = attr('className')?.getText(sf) ?? '';
      if (/\boption-button\b/.test(className)) {
        const active = className.match(/\$\{\s*([^}]+?)\s*\?\s*'active'\s*:\s*''\s*\}/)?.[1];
        const pressed = attr('aria-pressed');
        found.push({
          at: `${relative(SRC, file)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`,
          active: active === undefined ? null : squash(active),
          pressed: pressed && ts.isJsxExpression(pressed) && pressed.expression ? squash(pressed.expression.getText(sf)) : null,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe('option buttons', () => {
  const buttons = sources(SRC).flatMap(optionButtons);

  it('are all found: every settings pill row', () => {
    expect(buttons.length).toBeGreaterThanOrEqual(17);
  });

  it('each states aria-pressed, the same condition its active class reads', () => {
    const wrong = buttons
      .filter((b) => b.active === null || b.pressed !== b.active)
      .map((b) => `${b.at}: active when ${b.active}, aria-pressed ${b.pressed}`);
    expect(wrong).toEqual([]);
  });
});
