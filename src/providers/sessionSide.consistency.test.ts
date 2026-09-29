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
 * Also: only test-only modules import the adapter test kit or a
 * provider's fixtures (cases 6 and 7).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
 * test file; a module of the kit itself, or a provider's fixtures; or a
 * test-only helper — a module with at least one importer, all of whose
 * importers are test-only (as `src/providers/localInference/fakeEngines.ts`
 * is). A module nothing imports is not a helper. An import cycle outside
 * the tests is not test-only.
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
/** The kit, each provider's fixtures (`src/providers/<name>/testing.ts`) and any `*.testing.ts` (the recorded sessions' replay, Stage 2 translation cuts): whatever imports one must itself be test-only. */
const inKit = (f: string) => f.startsWith('src/lib/contract/testing/') || /^src\/providers\/[^/]+\/testing\.ts$/.test(f) || /\.testing\.ts$/.test(f);

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

    const soniox = sessionSide(REPO_ROOT, 'src/providers/soniox');
    expect(soniox).toEqual(expect.arrayContaining([
      'src/providers/soniox/adapter.ts',
      'src/providers/soniox/pcmMixer.ts',
      'src/providers/soniox/sideTracker.ts',
      'src/providers/soniox/socket.ts',
      'src/providers/soniox/speech.ts',
      'src/providers/soniox/sttStream.ts',
      'src/providers/soniox/ttsStream.ts',
      'src/providers/soniox/utterances.ts',
    ]));
    // The builder, the check and the settings side are not the session's: the adapter imports them as types only.
    for (const file of ['check.ts', 'config.ts', 'settings.ts', 'ttsRest.ts', 'voicesClient.ts']) {
      expect(soniox).not.toContain(`src/providers/soniox/${file}`);
    }

    const gemini = sessionSide(REPO_ROOT, 'src/providers/gemini');
    expect(gemini).toEqual(expect.arrayContaining([
      'src/providers/gemini/adapter.ts',
      'src/providers/gemini/hold.ts',
      'src/providers/gemini/socket.ts',
      'src/providers/gemini/tail.ts',
      'src/providers/gemini/turns.ts',
      'src/providers/gemini/wire.ts',
    ]));
    // The builder, the check, the settings, the definition and the fixtures are not the session's: reached as types only, or not at all.
    for (const file of ['check.ts', 'config.ts', 'settings.ts', 'provider.ts', 'testing.ts']) {
      expect(gemini).not.toContain(`src/providers/gemini/${file}`);
    }

    const ast2 = sessionSide(REPO_ROOT, 'src/providers/volcengine_ast2');
    expect(ast2).toEqual(expect.arrayContaining([
      'src/providers/volcengine_ast2/adapter.ts',
      'src/providers/volcengine_ast2/audioIn.ts',
      'src/providers/volcengine_ast2/decode.ts',
      // The generated codec, reached by its `.js` specifier: scanned like the rest (no timer, no store).
      'src/providers/volcengine_ast2/proto/ast2-proto.js',
      'src/providers/volcengine_ast2/segments.ts',
      'src/providers/volcengine_ast2/socket.ts',
      'src/providers/volcengine_ast2/speech.ts',
      'src/providers/volcengine_ast2/wire.ts',
    ]));
    // The builder, the check, the settings, the view, the definition and the fixtures are not the session's.
    for (const file of ['Ast2Settings.tsx', 'check.ts', 'config.ts', 'provider.ts', 'settings.ts', 'testing.ts']) {
      expect(ast2).not.toContain(`src/providers/volcengine_ast2/${file}`);
    }

    const translate = sessionSide(REPO_ROOT, 'src/providers/openai_translate');
    expect(translate).toEqual(expect.arrayContaining([
      'src/providers/openai_translate/adapter.ts',
      'src/providers/openai_translate/segments.ts',
      'src/providers/openai_translate/socket.ts',
      'src/providers/openai_translate/tail.ts',
      'src/providers/openai_translate/wire.ts',
    ]));
    // The builder, the check, the settings, the view, the definition and the fixtures are not the session's.
    for (const file of ['TranslateSettings.tsx', 'check.ts', 'config.ts', 'provider.ts', 'settings.ts', 'testing.ts']) {
      expect(translate).not.toContain(`src/providers/openai_translate/${file}`);
    }

    const realtime = sessionSide(REPO_ROOT, 'src/providers/openai');
    expect(realtime).toEqual([
      'src/providers/openai/adapter.ts',
      'src/providers/openai/items.ts',
      'src/providers/openai/queue.ts',
      'src/providers/openai/socket.ts',
      'src/providers/openai/wire.ts',
    ]);

    // Palabra's seam is the contract's (Stage 2 Palabra, choice 1): no `socket.ts` of its own. The builder, the check, the settings, the view, the definition and the fixtures are not the session's.
    const palabra = sessionSide(REPO_ROOT, 'src/providers/palabraai');
    expect(palabra).toEqual([
      'src/providers/palabraai/adapter.ts',
      'src/providers/palabraai/audioIn.ts',
      'src/providers/palabraai/items.ts',
      'src/providers/palabraai/wire.ts',
    ]);
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
    // The walk does not follow `src/lib/**`: the one shared module two session sides cut their segments with, by name (Stage 2 translation cuts, choice 1).
    expect(globalTimerCalls(readFileSync(join(REPO_ROOT, 'src/lib/segmentation/continuousSegments.ts'), 'utf-8'))).toEqual([]);
  });

  it("only test-only modules import the adapter test kit or a provider's fixtures", () => {
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

  it("the kit rule holds a provider's fixtures to tests (a fixture tree, never the real one)", () => {
    const root = mkdtempSync(join(tmpdir(), 'sokuji-kit-rule-'));
    try {
      mkdirSync(join(root, 'src/providers/gemini'), { recursive: true });
      // The real fixtures, copied alone: their own imports resolve to nothing here, so they import no kit module.
      writeFileSync(join(root, 'src/providers/gemini/testing.ts'), readFileSync(join(REPO_ROOT, 'src/providers/gemini/testing.ts'), 'utf-8'));
      // A scratch copy of a real non-test module, reaching for the fixtures; and a test that may.
      writeFileSync(join(root, 'src/providers/gemini/leak.ts'), `import { KEY } from './testing';\n${readFileSync(join(REPO_ROOT, 'src/providers/gemini/socket.ts'), 'utf-8')}\nexport const leaked = KEY;\n`);
      writeFileSync(join(root, 'src/providers/gemini/leak.test.ts'), "import { KEY } from './testing';\nexport const allowed = KEY;\n");
      const offenders = (kit: (f: string) => boolean) => {
        const { files, importers, targets } = importGraph(root);
        const testOnly = testOnlyModules(files, importers, isTest, kit);
        return files.filter((f) => (targets.get(f) ?? []).some(kit) && !testOnly.has(f));
      };
      expect(offenders(inKit)).toEqual(['src/providers/gemini/leak.ts']);
      // The control: the kit's own folder alone sees nothing here — the fixtures are held because they count as kit.
      expect(offenders((f) => f.startsWith('src/lib/contract/testing/'))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
    // A provider's `testing.ts`, one folder deep; nothing else of that name.
    expect(['src/providers/soniox/testing.ts', 'src/providers/gemini/testing.ts'].every(inKit)).toBe(true);
    expect(['src/providers/testing.ts', 'src/providers/gemini/sub/testing.ts', 'src/providers/gemini/testing.tsx', 'src/lib/testing.ts'].some(inKit)).toBe(false);
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
