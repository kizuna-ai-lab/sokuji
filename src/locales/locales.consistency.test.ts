import { describe, it, expect, vi } from 'vitest';
// Force every provider gate on so ALL descriptors register regardless of build
// env — same trick as descriptorRegistry.test.ts.
vi.mock('../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isKizunaAIEnabled: () => true,
  isPalabraAIEnabled: () => true,
  isLocalNativeEnabled: () => true,
  isElectron: () => true,
  isExtension: () => false,
  getRelayWsUrl: () => 'wss://r.example/v1',
}));
import { ProviderConfigFactory } from '../services/providers/ProviderConfigFactory';
import en from './en/translation.json';

const catalogs = import.meta.glob('./*/translation.json', { eager: true }) as
  Record<string, { default: Record<string, unknown> }>;

const flatten = (o: unknown, prefix = ''): Record<string, string> => {
  const out: Record<string, string> = {};
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o)) {
      Object.assign(out, flatten(v, prefix ? `${prefix}.${k}` : k));
    }
  } else {
    out[prefix] = o as string;
  }
  return out;
};

// Both conventions are live and are NOT interchangeable: {{x}} is i18next
// interpolation, {x} is a manual .replace() at the call site.
// Tolerates a non-string so a stray number/null surfaces as a readable diff on
// the offending key rather than a TypeError with no clue which key threw.
const placeholders = (s: unknown) =>
  (typeof s === 'string'
    ? s.match(/\{\{[^}]+\}\}|(?<!\{)\{[^{}]+\}(?!\})/g) ?? []
    : ['<not a string>']).sort();

const EN = flatten(en);
const locales = Object.entries(catalogs)
  .map(([path, mod]) => [path.split('/')[1], flatten(mod.default)] as const)
  .filter(([lang]) => lang !== 'en');

describe('locale catalogs stay in lockstep with en', () => {
  it.each(locales)('%s has exactly en\'s keys — no missing, no stale', (_lang, cat) => {
    expect(Object.keys(cat).sort()).toEqual(Object.keys(EN).sort());
  });

  it.each(locales)('%s preserves every en placeholder verbatim', (_lang, cat) => {
    const broken = Object.keys(EN)
      .filter(k => cat[k] !== undefined)
      .map(k => ({ k, want: placeholders(EN[k]), got: placeholders(cat[k]) }))
      .filter(({ want, got }) => JSON.stringify(want) !== JSON.stringify(got));
    expect(broken).toEqual([]);
  });

  it.each(locales)('%s has no empty strings', (_lang, cat) => {
    expect(Object.entries(cat).filter(([, v]) => typeof v !== 'string' || v === '')).toEqual([]);
  });
});

describe('dynamically-built i18n keys resolve in en', () => {
  // ProviderSpecificSettings renders one button per capabilities.turnDetection.mode
  // and derives the label key from the mode string. A mode whose key is absent
  // renders the raw key as the button text — Volcengine's 'Push-to-Talk' did
  // exactly that until it was folded into the settings.pushToTalk branch.
  it('every provider turn-detection mode maps to a key that exists', () => {
    const missing: string[] = [];
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      // Read through getConfig().capabilities — the exact path the component uses.
      const modes = ProviderConfigFactory.getConfig(id).capabilities.turnDetection.modes;
      for (const mode of modes) {
        const key = mode === 'Disabled' || mode === 'Push-to-Talk'
          ? 'settings.pushToTalk'
          : `settings.${mode.toLowerCase()}`;
        if (EN[key] === undefined) missing.push(`${id}: ${mode} -> ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
