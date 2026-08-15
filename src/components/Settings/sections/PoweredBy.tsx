import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Provider, isKizunaManagedProvider } from '../../../types/Provider';
import { ProviderConfigFactory } from '../../../services/providers/ProviderConfigFactory';

interface PoweredByProps {
  provider: Provider;
}

/**
 * "Powered by <vendor>" — the engine credit that sits beside the provider name
 * on Kizuna-managed rows, where the name itself is just "KizunaAI".
 *
 * Rendered through <Trans> rather than an interpolated t() so the vendor keeps
 * its own element: it is the token that carries the meaning, so it is typeset a
 * step stronger than the preposition, and word order moves between languages
 * (Japanese and Korean lead with the vendor).
 *
 * Renders nothing for a provider Kizuna does not host, and nothing for one that
 * is not registered in this build — a persisted selection can name a twin whose
 * feature flag is off, and ProviderSection already degrades that row to the
 * "Unknown" name, icon and description. Crediting an engine beside it would read
 * as "Unknown — Powered by Soniox". Both guards live here so callers can drop
 * the component in unconditionally.
 *
 * The vendor label is a locale string (`providers.<id>.vendor`) rather than a
 * constant, because "brand names are never translated" turns out to be false
 * here: the catalogs already localise Doubao as 豆包 in zh_CN/zh_TW. It is also
 * not the base provider's display name, which would give "Doubao AST 2.0" and
 * "OpenAI Translate" — both too long for the line it shares with the name.
 */
export const PoweredBy: React.FC<PoweredByProps> = ({ provider }) => {
  const { t } = useTranslation();
  if (!isKizunaManagedProvider(provider)) return null;
  if (!ProviderConfigFactory.isProviderSupported(provider)) return null;

  return (
    <span className="powered-by">
      <Trans
        i18nKey="providers.poweredBy"
        values={{ name: t(`providers.${provider}.vendor`) }}
        components={{ brand: <span className="powered-by-vendor" /> }}
      />
    </span>
  );
};

export default PoweredBy;
