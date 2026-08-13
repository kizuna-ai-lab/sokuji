import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// sessionStartGate is loaded by the Electron subtitle window. Its import list
// is a CONTRACT: exactly three leaf modules, none of which reach
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

describe('sessionStartGate import hygiene (subtitle window contract)', () => {
  it('imports only the three sanctioned leaf modules', () => {
    const specifiers = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]).sort();
    expect(specifiers).toEqual([
      '../../services/providers/sonioxManagedMinBalance',
      '../../types/Provider',
      '../../utils/formatters',
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
  it('sonioxManagedMinBalance stays an import-free leaf', () => {
    expect(sonioxManagedMinBalanceSrc).not.toMatch(/from\s+['"][^'"]+['"]/);
  });
});
