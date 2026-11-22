// src/components/providers/ProviderOption.tsx
//
// One provider as an <option> the way today's provider picker draws it: the
// icon, the name in large type, a short credit or note on the same line, and
// a description under it (owner, 2026-11-15: keep the picker's design). Where
// the select cannot draw rich options (Chrome below 135), the option is text.
import type { ComponentType } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { AnyProvider } from '../../lib/provider/types';

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
  /** Shown after the name and the option cannot be chosen: it cannot be combined with the other stages as they are. */
  blocked?: string;
  /**
   * Shown after the name, the option still a choice: what it needs before a session can start on it (a key, a
   * sign-in, an address), set up once it is chosen (owner, 2026-11-22). Not shown beside a `blocked` reason.
   */
  needs?: string;
  recommended?: boolean;
}

export function useOptionModel(): (id: string, provider?: AnyProvider) => ProviderOptionModel {
  const { t } = useTranslation();
  return (id, provider) => {
    if (provider?.kind === 'online') {
      // An online service's one line (`providers.<id>.note`, Bing's and Edge's) is its description (owner,
      // 2026-11-15): it says what it is, it credits no engine.
      return { id, icon: provider.icon, name: t(`providers.${id}.name`, id), description: t(`providers.${id}.note`, '') || undefined };
    }
    // Only the local provider has a note of its own (the online services' line is their description, above).
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
  const note = m.blocked || m.needs;
  return note ? `${named} (${note})` : named;
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
          {m.blocked ? <em className="provider-blocked">{m.blocked}</em> : m.needs && <em className="provider-needs">{m.needs}</em>}
        </span>
        {m.description && <span className="provider-select__description">{m.description}</span>}
      </span>
    </option>
  );
}
