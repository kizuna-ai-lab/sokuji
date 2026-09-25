import { Cpu, ExternalLink, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnalytics } from '../../lib/analytics';
import type { AnyProvider, AuthContext, EngineSlot } from '../../lib/provider/types';
import { storedProviderValue } from '../../lib/session/storedSettings';
import { openExternalUrl } from '../../utils/openExternalUrl';
import { useProviderStore } from '../../stores/providerStore';
import Tooltip from '../Tooltip/Tooltip';
import { CredentialForm } from './CredentialForm';
import { useSelectedProvider } from './useSelectedProvider';

/** Today's link (`ProviderSection.tsx:599`) — a literal, never imported from `src/services`. */
const AI_PROVIDERS_DOCS_URL = 'https://sokuji.kizuna.ai/docs/ai-providers';

/** Today's key (`ProviderSection.tsx`'s `DISMISSED_KEY`) — a dismissal made in today's Settings carries over. */
const DISMISSED_TUTORIALS_KEY = 'sokuji-dismissed-tutorials';

function readDismissedTutorials(): Set<string> {
  try {
    const stored = localStorage.getItem(DISMISSED_TUTORIALS_KEY);
    if (!stored) return new Set();
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? new Set(parsed as string[]) : new Set();
  } catch {
    return new Set();
  }
}

interface ProviderPickerProps {
  providers: readonly AnyProvider[];
  auth: AuthContext;
  /** A run is not idle: the picker and its credentials are locked. */
  disabled?: boolean;
  /** Present: draws the selected provider's `EngineSummary`, if it has one — Simple mode's way into its `Engine` (1e-3b-2 ruling 3). */
  openSlot?(slot: EngineSlot): void;
}

/**
 * The provider select, its credentials and readiness (D18, ruling 2): a plain
 * `<select>` — today's rich options with icons and descriptions are not
 * ported (stated departure, one provider offered until Stage 2) — then
 * `CredentialForm`, then the summary of its `Engine` when one is offered and
 * `openSlot` is given.
 */
export function ProviderPicker({ providers, auth, disabled, openSlot }: ProviderPickerProps) {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const legs = useProviderStore((s) => s.legs);
  const selection = useSelectedProvider(providers);
  const [dismissedTutorials, setDismissedTutorials] = useState<Set<string>>(readDismissedTutorials);

  if (!selection) return null;
  const { provider, entry, readiness, update } = selection;
  const { setCredential, refreshReadiness, select } = useProviderStore.getState();

  // Today's `ProviderSection.tsx` keys dismissal by the old enum's spelling
  // (e.g. `local_inference`), so a dismissal made there carries over.
  const storedProviderId = storedProviderValue(provider.id);
  const dismissTutorial = (id: string) => {
    const updated = new Set(dismissedTutorials);
    updated.add(id);
    setDismissedTutorials(updated);
    localStorage.setItem(DISMISSED_TUTORIALS_KEY, JSON.stringify([...updated]));
  };

  return (
    <div className="config-section provider-section" id="provider-section" data-tour="provider-section">
      <h3>
        <Cpu size={18} />
        <span>{t('simpleSettings.provider')}</span>
        <Tooltip
          content={
            <div>
              <p>{t('settings.providerTooltip')}</p>
              <p style={{ marginTop: '8px' }}>{t('simpleSettings.apiKeyHelpTooltip2')}</p>
              <a
                href={AI_PROVIDERS_DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#10a37f', textDecoration: 'underline' }}
              >
                {AI_PROVIDERS_DOCS_URL}
              </a>
            </div>
          }
          position="top"
          icon="help"
          maxWidth={350}
        />
      </h3>
      <div className="provider-selection-area">
        <select
          className="select-dropdown provider-select"
          value={provider.id}
          onChange={(e) => {
            const next = e.target.value;
            // Today's series (ProviderSection.tsx:512-520). A pick is refused during a run (1e-3b-1 ruling 7), so never during one.
            trackEvent('provider_switched', { from_provider: storedProviderValue(provider.id), to_provider: storedProviderValue(next), during_session: false });
            // A person's pick: it persists, in the old enum's spelling (1e-3b-1 ruling 8).
            select(next, 'pick');
          }}
          aria-label={t('simpleSettings.provider')}
          disabled={disabled}
        >
          {providers.map((p) => <option key={p.id} value={p.id}>{t(`providers.${storedProviderValue(p.id)}.name`, p.id)}</option>)}
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
      {openSlot && provider.EngineSummary && entry && (
        <provider.EngineSummary settings={entry.settings} update={update} disabled={disabled} pair={entry.pair} legs={legs} openSlot={openSlot} />
      )}
      {provider.guideUrl && !dismissedTutorials.has(storedProviderId) && (
        <div className="tutorial-link">
          <a href={provider.guideUrl} onClick={(e) => { e.preventDefault(); openExternalUrl(provider.guideUrl!); }}>
            <ExternalLink size={12} />
            {t('simpleSettings.setupGuide', 'Setup guide')}
          </a>
          <button type="button" className="tutorial-dismiss" onClick={() => dismissTutorial(storedProviderId)} title={t('common.dismiss', 'Dismiss')}>
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
