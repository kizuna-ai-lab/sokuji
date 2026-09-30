/**
 * The new structure never reaches the old provider path (Stage 2 deletion,
 * rulings 1 and 2). The old path is every module of `src/services/clients/`,
 * `src/services/providers/` and `src/services/interfaces/`: Local Native's
 * client, descriptor, factory and `IClient`, kept whole until
 * kizuna-ai-lab/sokuji#578 ports it. Only the
 * old path's own files (`OLD_PATH_FILES`) import one of its modules by
 * value — a static import or re-export, a side-effect import, a dynamic
 * `import()` or a `require()` — but for the shared leaves the new code takes
 * (`SHARED`). A type-only import is erased and allowed.
 *
 * When #578 ports Local Native, the old path and this list go together.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import ts from 'typescript';

const REPO_ROOT = resolve(__dirname, '../..');

/** The old path's modules: every file of these three folders. */
const OLD_PATH = /^src\/services\/(clients|providers|interfaces)\//;

/** Modules of those folders that are not the old path's: shared leaves the new code imports. */
const SHARED = new Set([
  'src/services/providers/ProviderConfig', // `LanguageOption`, `VoiceOption`
  'src/services/providers/astGuard', // `guardAstCrossStage`, LocalInference's AST check
  'src/services/providers/tutorialUrls', // `AI_PROVIDERS_DOCS_URL`, the wizard's docs link
  'src/services/interfaces/ISettingsService', // the settings service's interface, which the new session's stores read
]);

/** Besides `src/services/` itself, the files that may import the old path: the unmounted shell that renders Local Native, and the old store with its Local Native slice, with the tests that pin them. */
const OLD_PATH_FILES = new Set([
  'src/components/Settings/sections/LanguageSection.tsx',
  'src/components/Settings/sections/LanguageSection.sentence.test.tsx',
  'src/components/Settings/sections/ProviderSection.tsx',
  'src/stores/settingsStore.ts',
  'src/stores/settingsStore.selections.test.ts',
]);
const isOldPathFile = (file: string) => file.startsWith('src/services/') || OLD_PATH_FILES.has(file);

const parse = (source: string, fileName: string) =>
  ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, /\.[jt]sx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

/** Every specifier a file imports by value: `import … from`, `import '…'`, `export … from`, `import('…')`, `require('…')`; not `import type`, nor a named import whose every name is `type`. */
function valueSpecifiers(source: string, fileName = 'scan.ts'): string[] {
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
    } else if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      out.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(source, fileName));
  return out;
}

/** A relative specifier as a repo-relative module, extension dropped; null when it is not relative. */
function moduleOf(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  return posix.normalize(posix.join(dirname(from).split('\\').join('/'), spec)).replace(/\.(tsx?|jsx?|mjs)$/, '');
}

/** Every source file under `src` (no `.d.ts`). */
function sourceFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(root, dir))) {
      const rel = `${dir}/${entry}`;
      if (statSync(join(root, rel)).isDirectory()) walk(rel);
      else if (/\.(tsx?|jsx?|mjs)$/.test(entry) && !entry.endsWith('.d.ts')) files.push(rel);
    }
  };
  walk('src');
  return files.sort();
}

/** `file: module` for every value import of the old path from outside it. */
function offenders(root: string): string[] {
  return sourceFiles(root).filter((file) => !isOldPathFile(file)).flatMap((file) =>
    valueSpecifiers(readFileSync(join(root, file), 'utf-8'), file)
      .map((spec) => moduleOf(file, spec))
      .filter((target): target is string => target !== null && OLD_PATH.test(target) && !SHARED.has(target))
      .map((target) => `${file}: ${target}`));
}

describe('the old provider path', () => {
  it('is imported by value only by its own files', () => {
    expect(offenders(REPO_ROOT)).toEqual([]);
  });

  it('the scan sees every kind of value import, and no type-only one', () => {
    const source = [
      "import { ClientFactory } from '../../services/clients/ClientFactory';",
      "import '../../services/providers/ProviderConfigFactory';",
      "export { LocalNativeClient } from '../../services/clients/LocalNativeClient';",
      "const later = () => import('../../services/providers/LocalNativeProviderConfig');",
      "const old = require('../../services/clients/punctuateDefinite');",
      "import type { IClient } from '../../services/interfaces/IClient';",
      "import { type ProviderConfig } from '../../services/providers/ProviderConfig';",
    ].join('\n');
    expect(valueSpecifiers(source)).toEqual([
      '../../services/clients/ClientFactory',
      '../../services/providers/ProviderConfigFactory',
      '../../services/clients/LocalNativeClient',
      '../../services/providers/LocalNativeProviderConfig',
      '../../services/clients/punctuateDefinite',
    ]);
  });

  it('names only files that exist', () => {
    for (const file of OLD_PATH_FILES) expect(existsSync(join(REPO_ROOT, file)), file).toBe(true);
    for (const module of SHARED) expect(existsSync(join(REPO_ROOT, `${module}.ts`)), module).toBe(true);
  });
});
