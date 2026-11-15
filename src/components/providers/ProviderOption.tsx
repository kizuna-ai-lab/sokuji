// src/components/providers/ProviderOption.tsx
//
// One provider as an <option> the way today's provider picker draws it: the
// icon, the name in large type, a short credit or note on the same line, and
// a description under it (owner, 2026-11-15: keep the picker's design). Where
// the select cannot draw rich options (Chrome below 135), the option is text.
import type { ComponentType } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { AnyProvider } from '../../lib/provider/types';
import { BingIcon, EdgeIcon } from '../Icons/ProviderIcons';

export interface ProviderOptionModel {
  id: string;
  /** `providers.<id>.name` */
  name: string;
  /** The engine credited for a hosted provider ("Powered by Soniox"). */
  vendor?: string;
  /** The vendor joins the name where only text can be drawn: the two hosted providers are both named "KizunaAI". */
  vendorInText?: boolean;
  /** A short note where there is no vendor (`providers.<id>.note`). */
  note?: string;
  description?: string;
  icon?: ComponentType<{ size?: string | number }>;
  /** Shown after the name and the option cannot be chosen (no key, no sign-in). */
  blocked?: string;
  recommended?: boolean;
}

/** The two providers that are not in the registry: they run inside the local provider (Plan 4). */
const EXTRA: Record<string, { icon: ComponentType<{ size?: string | number }>; name: string; note: string }> = {
  bing: { icon: BingIcon, name: 'Bing', note: 'Free · online, a Microsoft service' },
  edge: { icon: EdgeIcon, name: 'Edge', note: 'Free · online, a Microsoft service' },
};

export function useOptionModel(): (id: string, provider?: AnyProvider) => ProviderOptionModel {
  const { t } = useTranslation();
  return (id, provider) => {
    const extra = EXTRA[id];
    if (extra) {
      // Their one line is their description (owner, 2026-11-15): it says what they are, it credits no engine.
      return { id, icon: extra.icon, name: t(`providers.${id}.name`, extra.name), description: t(`providers.${id}.note`, extra.note) };
    }
    // Only the local provider has a note of its own (Bing and Edge above).
    const note = id === 'local_inference' ? t('providers.local_inference.note', 'Free · offline') : undefined;
    return {
      id,
      name: t(`providers.${id}.name`, id),
      vendor: provider?.vendor,
      vendorInText: provider?.kind === 'managed',
      note: provider?.vendor ? undefined : note,
      description: t(`providers.${id}.description`, '') || undefined,
      icon: provider?.icon,
    };
  };
}

/** The option's text where only text can be drawn: the hosted providers carry their engine, since both are named "KizunaAI". */
export function optionText(m: ProviderOptionModel, recommend: (name: string) => string = (name) => name): string {
  const base = m.vendor && m.vendorInText ? `${m.name} (${m.vendor})` : m.name;
  const named = m.recommended ? recommend(base) : base;
  return m.blocked ? `${named} (${m.blocked})` : named;
}

export function ProviderOption({ model: m, rich, recommendedLabel }: { model: ProviderOptionModel; rich: boolean; recommendedLabel?: string }) {
  const { t } = useTranslation();
  if (!rich) {
    const recommend = (name: string) => t('simpleSettings.recommendedOption', '{{name}} ({{label}})', { name, label: recommendedLabel });
    return <option value={m.id} disabled={Boolean(m.blocked)}>{optionText(m, recommend)}</option>;
  }
  const Icon = m.icon;
  return (
    <option value={m.id} disabled={Boolean(m.blocked)}>
      {Icon && (
        <span className="provider-select__icon">
          <Icon size={20} />
        </span>
      )}
      <span className="provider-select__text">
        <span className="provider-name-line">
          <span className="provider-select__name">{m.name}</span>
          {m.vendor ? (
            <span className="powered-by">
              <Trans i18nKey="providers.poweredBy" values={{ name: m.vendor }} components={{ brand: <span className="powered-by-vendor" /> }} />
            </span>
          ) : m.note ? <span className="powered-by">{m.note}</span> : null}
          {m.recommended && recommendedLabel && <em className="provider-recommended">{recommendedLabel}</em>}
          {m.blocked && <em className="provider-blocked">{m.blocked}</em>}
        </span>
        {m.description && <span className="provider-select__description">{m.description}</span>}
      </span>
    </option>
  );
}
