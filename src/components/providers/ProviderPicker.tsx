import { Cpu, ExternalLink, X } from 'lucide-react';
import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useAnalytics } from '../../lib/analytics';
import type { AnyProvider, AuthContext, EngineSlot } from '../../lib/provider/types';
import { storedProviderValue } from '../../lib/session/storedSettings';
import { supportsBaseSelect } from '../../utils/supportsBaseSelect';
import { openExternalUrl } from '../../utils/openExternalUrl';
import { useProviderStore } from '../../stores/providerStore';
import Tooltip from '../Tooltip/Tooltip';
import { CredentialForm } from './CredentialForm';
import { ownProps, useSelectedProvider } from './useSelectedProvider';
// The rich option markup below (icon, name-line, description) is styled by
// the shared rules ProviderSection.tsx also relies on (`.provider-select__*`,
// `.provider-name-line`, `.powered-by` — see Settings.scss's "Rich provider
// rows" block). They are plain global CSS, not scoped to Settings.tsx's own
// tree, but this component owns the import too rather than depending on
// always being mounted under a page that already loaded it (ProviderSection.tsx,
// the only other importer of this markup, stays until Stage 2 no longer needs
// it — controller ruling 1).
import '../Settings/Settings.scss';

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
 * The provider select, its credentials and readiness (D18): today's rich
 * options — icon, name (with its engine credit) and description — ported
 * from `ProviderSection.tsx`'s `renderProviderOption` (the owner reversed
 * plan 1e-3b-2 ruling 2's "plain `<select>`" departure). Then `CredentialForm`,
 * then the summary of its `Engine` when one is offered and `openSlot` is
 * given.
 */
export function ProviderPicker({ providers, auth, disabled, openSlot }: ProviderPickerProps) {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const legs = useProviderStore((s) => s.legs);
  const selection = useSelectedProvider(providers);
  const [dismissedTutorials, setDismissedTutorials] = useState<Set<string>>(readDismissedTutorials);
  // Whether this runtime renders customizable selects (appearance:
  // base-select) — a one-shot init, like ProviderSection.tsx's own richSelect
  // state, since it never changes for the life of the page. Where it's
  // unsupported (the extension's Chrome-116 floor), a classic OS-drawn popup
  // would flatten or hide rich option children, so the option falls back to
  // plain text.
  const [richSelect] = useState(() => supportsBaseSelect());

  if (!selection) return null;
  const { provider, entry, readiness } = selection;
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

  // One renderer for every provider option — ports ProviderSection.tsx's
  // renderProviderOption (~:551-586) over the new registry: name/description
  // key off the old enum's spelling (storedProviderValue), same as the
  // option's `value`; a provider whose keys are missing falls back to its id
  // for the name (as today) and no description line at all. The icon and
  // vendor come straight off the definition (`p.icon`, `p.vendor`) rather
  // than a separate UI-layer lookup table.
  //
  // No "Recommended" tag: no managed provider is offered on this branch
  // (Stage 2 brings it back with the managed step).
  const renderProviderOption = (p: AnyProvider) => {
    const storedId = storedProviderValue(p.id);
    const name = t(`providers.${storedId}.name`, p.id);
    if (!richSelect) {
      // Chrome below 135 renders <option>{text}</option> and drops every
      // child element, so on the extension's floor (116) the option holds
      // text only.
      return <option key={p.id} value={p.id}>{name}</option>;
    }
    const description = t(`providers.${storedId}.description`, '');
    const vendor = p.vendor;
    return (
      <option key={p.id} value={p.id}>
        <span className="provider-select__icon">
          <p.icon size={20} />
        </span>
        <span className="provider-select__text">
          {/* Name and engine credit share one line: crediting an engine only
              matters where the name alone doesn't say which one it is (the
              Kizuna-managed twins, none offered on this branch — see above). */}
          <span className="provider-name-line">
            <span className="provider-select__name">{name}</span>
            {vendor && (
              <span className="powered-by">
                <Trans
                  i18nKey="providers.poweredBy"
                  values={{ name: vendor }}
                  components={{ brand: <span className="powered-by-vendor" /> }}
                />
              </span>
            )}
          </span>
          {description && <span className="provider-select__description">{description}</span>}
        </span>
      </option>
    );
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
          {richSelect && (
            // The closed control mirrors the selected option's markup; CSS
            // trims it down (see .provider-select selectedcontent in
            // Settings.scss).
            <button type="button"><selectedcontent /></button>
          )}
          {providers.map((p) => renderProviderOption(p))}
        </select>
      </div>
      {entry && (
        <CredentialForm
          fields={provider.credentials.fields(entry.settings)}
          values={entry.credentials}
          readiness={readiness}
          onChange={(key, value) => setCredential(provider, key, value)}
          // A local provider checks itself, and a managed one follows the sign-in (F1): only an own-key provider offers Validate.
          onCheck={provider.kind === 'own-key' ? () => {
            void refreshReadiness(provider, auth).then((answer) => {
              // Today's event (ProviderSection.tsx's handleValidateApiKey), for the button a person pressed.
              trackEvent('api_key_validated', {
                provider: storedProviderValue(provider.id),
                success: answer.state === 'ready',
                ...(answer.state === 'not-ready' && answer.code ? { error_type: answer.code } : {}),
              });
            });
          } : undefined}
          disabled={disabled}
        />
      )}
      {openSlot && provider.EngineSummary && entry && (
        <provider.EngineSummary {...ownProps(selection, entry, disabled)} legs={legs} openSlot={openSlot} />
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
