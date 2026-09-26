/**
 * A provider's session side — its `adapter.ts` and every file of its own
 * folder the adapter reaches by a value import — follows the rules
 * CLAUDE.md sets for clients (F17): it never imports a store or the
 * reporter (an adapter cannot know which leg it serves; it says what
 * happened through its events — `degraded`, `failed`, `closed`, `frame`),
 * and every timer it runs reads the request's clock (the F9 convention),
 * never a global one or the wall clock.
 *
 * Not the session hooks (`prepare`, `admit`, `acquire`, `startBoth`), by
 * the spec (Stage 2 foundation, choice 11):
 * - they may read the provider's own stores ("A provider's own stores are
 *   its own business"; LocalInference's shipped `admit` reads `modelStore`);
 * - they run on the runner's side of a run, not inside one leg's session,
 *   so a failure becomes the run's refusal, `end(notice)` or a release the
 *   runner reports;
 * - what they must not read — the live stores the run's shape froze — they
 *   are handed as `shape`, and `acquire`'s timers read `ctx.clock`.
 *
 * The limit: a module outside the provider's folder (`src/lib/**`) is not
 * followed — the spine's modules are held by their own rules.
 *
 * Also: only test-only modules import the adapter test kit (case 6).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';

const REPO_ROOT = resolve(__dirname, '../..');
const parse = (source: string, fileName: string) =>
  ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

/** The specifiers a file imports or re-exports as values: `import type`, and a named import whose every name is `type`, are not. */
function valueImports(source: string, fileName = 'scan.ts'): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const typeOnly = clause?.isTypeOnly === true
        || (clause !== undefined && clause.name === undefined && named !== undefined && ts.isNamedImports(named)
          && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly));
      if (!typeOnly) out.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      out.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      out.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(source, fileName));
  return out;
}

const TIMERS = new Set(['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame']);
const GLOBALS = new Set(['window', 'globalThis', 'self']);

/** The global timers and wall-clock reads a file calls. */
function globalTimerCalls(source: string, fileName = 'scan.ts'): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && TIMERS.has(callee.text)) out.push(callee.text);
      else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
        const target = callee.expression.text;
        const name = callee.name.text;
        if ((target === 'Date' || target === 'performance') && name === 'now') out.push(`${target}.now`);
        else if (GLOBALS.has(target) && TIMERS.has(name)) out.push(`${target}.${name}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(source, fileName));
  return out;
}

const FORBIDDEN = [/(^|\/)stores\//, /(^|\/)lib\/diagnostics\/report$/];

/** A relative specifier from `from` as a repo-relative file; null when it is not relative or not found. */
function resolveFile(root: string, from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = join(dirname(from), spec);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx'), base]) {
    const rel = candidate.split('\\').join('/');
    if (existsSync(join(root, rel)) && statSync(join(root, rel)).isFile()) return rel;
  }
  return null;
}

/** `dir/adapter.ts` and every file of `dir` it reaches by value imports. */
function sessionSide(root: string, dir: string): string[] {
  const seen = new Set([`${dir}/adapter.ts`]);
  const queue = [...seen];
  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const spec of valueImports(readFileSync(join(root, file), 'utf-8'), file)) {
      const next = resolveFile(root, file, spec);
      if (next && next.startsWith(`${dir}/`) && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return [...seen].sort();
}

/** `file: specifier` for every store or reporter a session side imports as a value. */
const storeOffenders = (root: string, dir: string) => sessionSide(root, dir).flatMap((file) =>
  valueImports(readFileSync(join(root, file), 'utf-8'), file).filter((s) => FORBIDDEN.some((re) => re.test(s))).map((s) => `${file}: ${s}`));

/** `file: call` for every global timer or wall-clock read on a session side. */
const timerOffenders = (root: string, dir: string) => sessionSide(root, dir).flatMap((file) =>
  globalTimerCalls(readFileSync(join(root, file), 'utf-8'), file).map((call) => `${file}: ${call}`));

const providerDirs = () => readdirSync(join(REPO_ROOT, 'src/providers'))
  .map((entry) => `src/providers/${entry}`)
  .filter((dir) => statSync(join(REPO_ROOT, dir)).isDirectory());

/**
 * Test-only modules (Stage 2 foundation, choice 10 and the kit rule): a
 * test file; a module of the kit itself; or a test-only helper — a module
 * with at least one importer, all of whose importers are test-only (as
 * `src/providers/localInference/fakeEngines.ts` is). A module nothing
 * imports is not a helper. An import cycle outside the tests is not
 * test-only.
 */
function testOnlyModules(files: readonly string[], importers: ReadonlyMap<string, ReadonlySet<string>>, isTest: (f: string) => boolean, inKit: (f: string) => boolean): Set<string> {
  const memo = new Map<string, boolean>();
  const visiting = new Set<string>();
  const check = (file: string): boolean => {
    const known = memo.get(file);
    if (known !== undefined) return known;
    if (isTest(file) || inKit(file)) { memo.set(file, true); return true; }
    if (visiting.has(file)) return false;
    visiting.add(file);
    const from = [...(importers.get(file) ?? [])];
    const answer = from.length > 0 && from.every(check);
    visiting.delete(file);
    memo.set(file, answer);
    return answer;
  };
  return new Set(files.filter(check));
}

const isTest = (f: string) => /\.test\.tsx?$/.test(f);
const inKit = (f: string) => f.startsWith('src/lib/contract/testing/');

/** Every `.ts` / `.tsx` under `src` (no `.d.ts`), the files each imports by value (resolved), and who imports each. */
function importGraph(root: string): { files: string[]; importers: Map<string, Set<string>>; targets: Map<string, string[]> } {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(root, dir))) {
      const rel = `${dir}/${entry}`;
      if (statSync(join(root, rel)).isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) files.push(rel);
    }
  };
  walk('src');
  const importers = new Map<string, Set<string>>();
  const targets = new Map<string, string[]>();
  for (const file of files) {
    const resolved = valueImports(readFileSync(join(root, file), 'utf-8'), file)
      .map((spec) => resolveFile(root, file, spec))
      .filter((target): target is string => target !== null);
    targets.set(file, resolved);
    for (const target of resolved) importers.set(target, (importers.get(target) ?? new Set()).add(file));
  }
  return { files, importers, targets };
}

describe('a provider session side', () => {
  it('every provider keeps its adapter in adapter.ts, and the walk follows its folder', () => {
    for (const dir of providerDirs()) {
      expect(existsSync(join(REPO_ROOT, dir, 'adapter.ts')), `${dir}: missing adapter.ts`).toBe(true);
    }
    expect(sessionSide(REPO_ROOT, 'src/providers/localInference')).toEqual(
      expect.arrayContaining([
        'src/providers/localInference/adapter.ts',
        'src/providers/localInference/engines.ts',
        'src/providers/localInference/sentenceCut.ts',
        'src/providers/localInference/speech.ts',
      ]),
    );
    const fake = sessionSide(REPO_ROOT, 'src/providers/fake');
    expect(fake).toEqual(expect.arrayContaining(['src/providers/fake/adapter.ts', 'src/providers/fake/synth.ts']));
    expect(fake).not.toContain('src/providers/fake/script.ts');
  });

  it('reads imports the way the compiler does', () => {
    expect(valueImports("import { a } from './a';")).toEqual(['./a']);
    expect(valueImports("import type { B } from './b';")).toEqual([]);
    expect(valueImports("import { type C } from './c';")).toEqual([]);
    expect(valueImports("import { d, type E } from './d';")).toEqual(['./d']);
    expect(valueImports("import './side';")).toEqual(['./side']);
    expect(valueImports("export { f } from './f';")).toEqual(['./f']);
    expect(valueImports("export type { G } from './g';")).toEqual([]);
    expect(valueImports("const m = await import('./lazy');")).toEqual(['./lazy']);
    expect(valueImports("// import { x } from './x'")).toEqual([]);
  });

  it('finds the global timers and the wall clock, and nothing else', () => {
    expect(globalTimerCalls('setTimeout(f, 1)')).toEqual(['setTimeout']);
    expect(globalTimerCalls('clock.setTimeout(f, 1)')).toEqual([]);
    expect(globalTimerCalls('this.clock.setTimeout(f, 1)')).toEqual([]);
    expect(globalTimerCalls('Date.now()')).toEqual(['Date.now']);
    expect(globalTimerCalls('performance.now()')).toEqual(['performance.now']);
    expect(globalTimerCalls('window.setInterval(f, 5)')).toEqual(['window.setInterval']);
    expect(globalTimerCalls("const s = 'setTimeout(x)'")).toEqual([]);
    expect(globalTimerCalls('// setInterval(f)')).toEqual([]);
  });

  it('a session side imports no store and no reporter as a value', () => {
    expect(providerDirs().flatMap((dir) => storeOffenders(REPO_ROOT, dir))).toEqual([]);
  });

  it("a session side runs no global timer: every timer reads the request's clock", () => {
    expect(providerDirs().flatMap((dir) => timerOffenders(REPO_ROOT, dir))).toEqual([]);
  });

  it('only test-only modules import the adapter test kit', () => {
    const { files, importers, targets } = importGraph(REPO_ROOT);
    const testOnly = testOnlyModules(files, importers, isTest, inKit);
    const offenders = files.filter((f) => (targets.get(f) ?? []).some(inKit) && !testOnly.has(f));
    expect(offenders).toEqual([]);
    // The walk's control: it actually traversed the tree.
    expect(files.length).toBeGreaterThan(300);
    // The helper control.
    expect(testOnly.has('src/providers/localInference/fakeEngines.ts')).toBe(true);
    expect(testOnly.has('src/providers/localInference/adapter.ts')).toBe(false);
    // The definition's control, on a synthetic graph.
    const synFiles = ['a.test.ts', 'helper.ts', 'deep.ts', 'app.ts', 'used.ts', 'cyc1.ts', 'cyc2.ts', 'orphan.ts'];
    const synImporters = new Map<string, Set<string>>([
      ['helper.ts', new Set(['a.test.ts'])],
      ['deep.ts', new Set(['helper.ts'])],
      ['used.ts', new Set(['app.ts', 'a.test.ts'])],
      ['cyc1.ts', new Set(['cyc2.ts'])],
      ['cyc2.ts', new Set(['cyc1.ts'])],
    ]);
    const synIsTest = (f: string) => f === 'a.test.ts';
    const synInKit = () => false;
    const synTestOnly = testOnlyModules(synFiles, synImporters, synIsTest, synInKit);
    expect([...synTestOnly].sort()).toEqual(['a.test.ts', 'deep.ts', 'helper.ts']);
  });

  it('the rules catch a violating provider (a fixture tree, never the real one)', () => {
    const root = mkdtempSync(join(tmpdir(), 'sokuji-session-side-'));
    mkdirSync(join(root, 'src/providers/probe'), { recursive: true });
    writeFileSync(join(root, 'src/providers/probe/adapter.ts'), "import { keepAlive } from './proto';\nimport type { T } from './types';\nexport const run = (t: T) => keepAlive(t);\n");
    writeFileSync(join(root, 'src/providers/probe/proto.ts'), "import { useProviderStore } from '../../stores/providerStore';\nexport function keepAlive(t: number) { setInterval(() => useProviderStore.getState(), t); return Date.now(); }\n");
    writeFileSync(join(root, 'src/providers/probe/types.ts'), 'export type T = number;\n');

    expect(sessionSide(root, 'src/providers/probe')).toEqual([
      'src/providers/probe/adapter.ts',
      'src/providers/probe/proto.ts',
    ]);
    expect(storeOffenders(root, 'src/providers/probe')).toEqual([
      'src/providers/probe/proto.ts: ../../stores/providerStore',
    ]);
    expect(timerOffenders(root, 'src/providers/probe')).toEqual([
      'src/providers/probe/proto.ts: setInterval',
      'src/providers/probe/proto.ts: Date.now',
    ]);
  });
});
