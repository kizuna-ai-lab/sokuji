/**
 * The Kizuna-managed twins are all called "KizunaAI"; the engine each one runs
 * on appears as an attribution beside the name — "KizunaAI  Powered by Soniox".
 *
 * The vendor is the token that carries the meaning, so it gets its own element
 * and is typeset a step stronger than the preposition. That is also why this
 * renders through <Trans> instead of a flat interpolated t(): word order moves
 * between languages (Japanese and Korean lead with the vendor) and the vendor
 * has to stay styleable wherever the sentence puts it.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '../../../locales';
import en from '../../../locales/en/translation.json';
import { Provider, isKizunaManagedProvider } from '../../../types/Provider';
import { ProviderConfigFactory } from '../../../services/providers/ProviderConfigFactory';
import { PoweredBy } from './PoweredBy';

const providers = en.providers as Record<string, { vendor?: string; name?: string }>;

describe('PoweredBy', () => {
  it('gives every Kizuna-managed provider a vendor label', () => {
    // A fourth managed twin without a vendor key would render the raw key
    // string as the brand, so fail here rather than in the panel.
    const missing = Object.values(Provider)
      .filter(isKizunaManagedProvider)
      .filter((p) => !providers[p]?.vendor);

    expect(missing).toEqual([]);
  });

  it('renders the attribution with the vendor in its own element', () => {
    const { container } = render(<PoweredBy provider={Provider.KIZUNA_AI_SONIOX} />);

    expect(container.textContent).toBe('Powered by Soniox');
    expect(container.querySelector('.powered-by-vendor')?.textContent).toBe('Soniox');
  });

  it('uses the short vendor label rather than the base provider display name', () => {
    // The obvious shortcut — resolve kizunaBaseProvider() and reuse its display
    // name — yields "Doubao AST 2.0" and "OpenAI Translate". Both overflow the
    // one line this attribution shares with the provider name.
    const { container } = render(<PoweredBy provider={Provider.KIZUNA_AI_VOLCENGINE_AST2} />);

    expect(container.querySelector('.powered-by-vendor')?.textContent).toBe('Doubao');
    expect(providers.volcengine_ast2?.name).toBe('Doubao AST 2.0');
  });

  it('renders nothing for a provider Kizuna does not host', () => {
    const { container } = render(<PoweredBy provider={Provider.SONIOX} />);

    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when the twin is not registered in this build', () => {
    // A persisted selection can name a provider whose feature flag is off in
    // the running build. ProviderSection already degrades that row to the
    // "Unknown" name, icon and description; crediting an engine next to it
    // would read as "Unknown — Powered by Soniox".
    const supported = vi.spyOn(ProviderConfigFactory, 'isProviderSupported').mockReturnValue(false);
    try {
      const { container } = render(<PoweredBy provider={Provider.KIZUNA_AI_SONIOX} />);
      expect(container.innerHTML).toBe('');
    } finally {
      supported.mockRestore();
    }
  });
});
