import { Cpu } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { AnyProvider, AuthContext } from '../../lib/provider/types';
import { UNKNOWN, useProviderStore } from '../../stores/providerStore';
import { CredentialForm } from './CredentialForm';
import { LanguagePairSection } from './LanguagePairSection';

interface ProviderPanelProps {
  providers: readonly AnyProvider[];
  auth: AuthContext;
  /** A run is not idle: provider, languages, mode and the provider's own settings are locked. */
  disabled?: boolean;
}

/**
 * Every provider, drawn from its definition alone: the picker, its
 * credentials and readiness, its language pair, then its own `Settings`
 * component (D18). Nothing here names a provider.
 */
export function ProviderPanel({ providers, auth, disabled }: ProviderPanelProps) {
  const { t } = useTranslation();
  const selected = useProviderStore((st) => st.selected);
  const provider = providers.find((p) => p.id === selected) ?? providers[0];
  const entry = useProviderStore((st) => (provider ? st.entries[provider.id] : undefined));
  const readiness = useProviderStore((st) => (provider ? st.readiness[provider.id] : undefined)) ?? UNKNOWN;
  const { load, updateSettings, setCredential, setPair, refreshReadiness, select } = useProviderStore.getState();

  useEffect(() => {
    if (provider && !entry) void load(provider);
  }, [provider, entry, load]);

  // The store holds what the panel shows, so a run starts the provider on screen.
  useEffect(() => {
    if (provider && selected !== provider.id) select(provider.id);
  }, [provider, selected, select]);

  // One identity per provider: a Settings/Engine may hold `update` in an effect's deps.
  const update = useCallback(
    (patch: Readonly<Record<string, unknown>>) => { if (provider) updateSettings(provider, patch); },
    [provider, updateSettings],
  );

  if (!provider) return null;
  const Settings = provider.Settings;
  const Engine = provider.Engine;

  return (
    <>
      <div className="config-section provider-section" id="provider-section">
        <h3>
          <Cpu size={18} />
          <span>{t('simpleSettings.provider')}</span>
        </h3>
        <div className="provider-selection-area">
          <select
            className="select-dropdown provider-select"
            value={provider.id}
            onChange={(e) => select(e.target.value, 'pick')}
            aria-label={t('simpleSettings.provider')}
            disabled={disabled}
          >
            {providers.map((p) => <option key={p.id} value={p.id}>{t(`providers.${p.id}.name`, p.id)}</option>)}
          </select>
        </div>
        {entry && (
          <CredentialForm
            fields={provider.credentials.fields(entry.settings)}
            values={entry.credentials}
            readiness={readiness}
            onChange={(key, value) => setCredential(provider, key, value)}
            onCheck={provider.kind === 'local' ? undefined : () => void refreshReadiness(provider, auth)}
            disabled={disabled}
          />
        )}
      </div>
      {entry && (
        <>
          <LanguagePairSection provider={provider} settings={entry.settings} pair={entry.pair} onChange={(pair) => setPair(provider, pair)} disabled={disabled} />
          <Settings settings={entry.settings} update={update} disabled={disabled} pair={entry.pair} />
          {Engine && (
            <Engine settings={entry.settings} update={update} disabled={disabled} pair={entry.pair} />
          )}
        </>
      )}
    </>
  );
}
