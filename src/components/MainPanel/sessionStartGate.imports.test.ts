import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// sessionStartGate is loaded by the Electron subtitle window. Its import list
// is a CONTRACT: exactly four leaf modules, none of which reach
// ProviderConfigFactory — that barrel imports every descriptor, and the
// descriptors pull the client graph and the i18n bootstrap behind them.
// planBothMode/capabilities answers reach the gate as derived primitives
// computed by MainPanel, never via a descriptor lookup inside the gate.
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'sessionStartGate.ts'), 'utf8');
const providersDir = join(here, '..', '..', 'services', 'providers');
const sonioxManagedMinBalanceSrc = readFileSync(
  join(providersDir, 'sonioxManagedMinBalance.ts'),
  'utf8'
);
const effectiveTextOnlySrc = readFileSync(
  join(here, '..', '..', 'utils', 'effectiveTextOnly.ts'),
  'utf8'
);

// The scan below used to match only `from '...'` clauses — a side-effect
// import (`import 'x'`), a dynamic `import('x')`, or a `require('x')` would
// add a real dependency to this file while sailing straight past the
// contract test below. Collect all four specifier forms into one sorted
// list so the assertion actually covers every way a specifier can enter
// this file, not just the one shape the original author happened to write.
const IMPORT_SPECIFIER_PATTERNS = [
  /from\s+['"]([^'"]+)['"]/g, // import ... from 'x'; export ... from 'x'
  /import\s+['"]([^'"]+)['"]/g, // side-effect: import 'x'
  /import\(\s*['"]([^'"]+)['"]\s*\)/g, // dynamic: import('x')
  /require\(\s*['"]([^'"]+)['"]\s*\)/g, // require('x')
];

function collectImportSpecifiers(source: string): string[] {
  const found: string[] = [];
  for (const pattern of IMPORT_SPECIFIER_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      found.push(match[1]);
    }
  }
  return found.sort();
}

describe('sessionStartGate import hygiene (subtitle window contract)', () => {
  it('imports only the four sanctioned leaf modules', () => {
    const specifiers = collectImportSpecifiers(src);
    expect(specifiers).toEqual([
      '../../services/providers/sonioxManagedMinBalance',
      '../../types/Provider',
      '../../utils/effectiveTextOnly',
      '../../utils/formatters',
    ]);
  });

  // The widened scan above is worthless if it can't actually see the import
  // forms it claims to cover. Run it against a sample that uses all three
  // non-`from` shapes (plus an ordinary `from` import, to prove they don't
  // double-count each other) and confirm every specifier surfaces exactly
  // once.
  it('the scan captures side-effect, dynamic, and require specifiers too', () => {
    const sample = `
      import 'side-effect-module';
      import Foo from 'from-module';
      const mod = await import('dynamic-module');
      const other = require('require-module');
    `;
    expect(collectImportSpecifiers(sample)).toEqual([
      'dynamic-module',
      'from-module',
      'require-module',
      'side-effect-module',
    ]);
  });

  it('never names ProviderConfigFactory or a descriptor module', () => {
    expect(src).not.toMatch(/ProviderConfigFactory/);
    expect(src).not.toMatch(/ProviderConfig'/);
    expect(src).not.toMatch(/sonioxBothMode/);
  });

  // The whitelist above only proves the gate's OWN import list is clean; it
  // says nothing about what those three sanctioned modules import in turn.
  // sonioxManagedMinBalance.ts is documented as import-free (see its own file
  // header) specifically so it can sit behind this gate without reopening a
  // path to ProviderConfigFactory one hop down. Pin that directly rather than
  // trusting the comment.
  // Asserted through `collectImportSpecifiers`, not a bare `from '...'` regex:
  // that narrow shape is exactly the hole the widened scan above was built to
  // close, and it would wave through a side-effect import, a dynamic import or
  // a require — any of which reopens the path to ProviderConfigFactory one hop
  // down while this test still passes.
  it('sonioxManagedMinBalance stays an import-free leaf', () => {
    expect(collectImportSpecifiers(sonioxManagedMinBalanceSrc)).toEqual([]);
  });

  // Same deal for the text-only resolver: it is read by the settings panel, the
  // settings store, MainPanel and this gate, and only stays safe behind the
  // subtitle window while it imports nothing at all.
  it('effectiveTextOnly stays an import-free leaf', () => {
    expect(collectImportSpecifiers(effectiveTextOnlySrc)).toEqual([]);
  });
});
