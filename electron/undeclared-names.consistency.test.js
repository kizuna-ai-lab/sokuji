// electron/undeclared-names.consistency.test.js
//
// No main-process file refers to a name it never declares.
//
// main.js cannot be booted in vitest, so a name it uses but no longer imports
// fails only at run time, in the one handler that reaches it. Merging main's
// light theme did exactly that: main had imported `desktopCapturer` while
// nothing used it, its review dropped the import as unused, and the merge took
// that line without a conflict, so the screen-context picker's
// `desktopCapturer.getSources()` threw "desktopCapturer is not defined" while
// every test stayed green. TypeScript's checker, run over the source files as
// JavaScript, finds such a name in under a second.
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/** "Cannot find name 'x'", and the same with "Did you mean 'y'?". */
const UNDECLARED = new Set([2304, 2552]);

/**
 * Every comment's span, read from the parsed source: the trivia before and after each node. A string such as '/*'
 * is a node's text, never trivia, so it hides nothing.
 */
function commentSpans(source) {
  const spans = [];
  const add = (ranges) => { for (const range of ranges ?? []) spans.push([range.pos, range.end]); };
  const visit = (node) => {
    add(ts.getLeadingCommentRanges(source.text, node.pos));
    add(ts.getTrailingCommentRanges(source.text, node.end));
    ts.forEachChild(node, visit);
  };
  visit(source);
  return spans;
}

/** Inside a comment: a JSDoc type naming nothing never runs. */
function inComment(spans, at) {
  return spans.some(([start, end]) => at >= start && at < end);
}

describe('commentSpans', () => {
  it("finds a JSDoc comment, and is not fooled by '/*' inside a string", () => {
    const text = "const glob = '/*';\nmissing();\n/** @type {Nope} */\nconst x = 1;\n";
    const spans = commentSpans(ts.createSourceFile('sample.js', text, ts.ScriptTarget.ES2022, true));
    expect(inComment(spans, text.indexOf('missing'))).toBe(false);
    expect(inComment(spans, text.indexOf('Nope'))).toBe(true);
  });
});

describe('electron main-process sources', () => {
  it('refer to no name they never declare', { timeout: 30_000 }, () => {
    const files = readdirSync(__dirname)
      .filter((name) => name.endsWith('.js') && !name.includes('.test.'))
      .map((name) => join(__dirname, name));
    expect(files.length).toBeGreaterThan(0);

    const program = ts.createProgram(files, {
      allowJs: true,
      checkJs: true,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      types: ['node'],
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    });

    const undeclared = [];
    for (const file of files) {
      const source = program.getSourceFile(file);
      const spans = commentSpans(source);
      for (const diagnostic of program.getSemanticDiagnostics(source)) {
        if (!UNDECLARED.has(diagnostic.code) || inComment(spans, diagnostic.start)) continue;
        const { line } = source.getLineAndCharacterOfPosition(diagnostic.start);
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
        undeclared.push(`electron/${file.slice(__dirname.length + 1)}:${line + 1} ${message}`);
      }
    }
    expect(undeclared).toEqual([]);
  });
});
