// src/components/SettingsPage/SonioxKeyForm.tsx
//
// Soniox's key on the accounts page (B-11; the owner chose the full version, 2026-11-17). A Soniox key belongs to one
// region's project and works there only, and nobody should have to know which region theirs came from: a pasted key
// is tried in every region and kept where it is accepted. Each region's key is shown, the selected one marked; when
// the selected region has no key and another has, switching to it is one click.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AnyProvider, AuthContext } from '../../lib/provider/types';
import { requestRegionChange } from '../../lib/region/regionChange';
import { asSonioxRegion, SONIOX_REGION_LABELS, SONIOX_REGIONS, type SonioxRegion } from '../../lib/soniox/regions';
import { noticeText } from '../../lib/view/noticeText';
import { regionsAccepting, type KeyRegions } from '../../providers/soniox/keyRegion';
import { SONIOX_KEY_FIELD, type SonioxSettings } from '../../providers/soniox/settings';
import { useProviderStore } from '../../stores/providerStore';

type Outcome =
  | { kind: 'saved'; region: SonioxRegion }
  | { kind: 'refused' }
  | { kind: 'unreachable'; region: SonioxRegion };

export function SonioxKeyForm({ provider, auth, disabled, detect, onChecked }: {
  provider: AnyProvider;
  auth: AuthContext;
  disabled: boolean;
  /** Which regions accept a key; the regions themselves are asked unless a test says otherwise. */
  detect?: (key: string) => Promise<KeyRegions>;
  /** Called with the selected region's check, once a key is kept for it. */
  onChecked?: (answer: Awaited<ReturnType<ReturnType<typeof useProviderStore.getState>['refreshReadiness']>>) => void;
}) {
  const { t } = useTranslation();
  const entry = useProviderStore((s) => s.entries[provider.id]);
  const readiness = useProviderStore((s) => s.readiness[provider.id]);
  const settings = entry?.settings as SonioxSettings | undefined;
  const credentials = (entry?.credentials ?? {}) as Record<string, string>;
  const selected = asSonioxRegion(settings?.region);
  const keyOf = (r: SonioxRegion) => (credentials[SONIOX_KEY_FIELD[r]] ?? '').trim();
  const [draft, setDraft] = useState(() => keyOf(selected));
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // The field shows the selected region's key; another region selected, its own.
  useEffect(() => { setDraft(keyOf(selected)); setOutcome(null); }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!entry || !settings) return null;
  const label = (r: SonioxRegion) => SONIOX_REGION_LABELS[r];
  const keep = (r: SonioxRegion, key: string) => useProviderStore.getState().setCredential(provider, SONIOX_KEY_FIELD[r], key);

  const save = async () => {
    const key = draft.trim();
    if (!key) return;
    setBusy(true);
    setOutcome(null);
    try {
      const { accepted, unreachable } = await (detect ?? ((k) => regionsAccepting(k, settings)))(key);
      // Kept where it is accepted, the selected region first; asked nowhere, kept for the selected region as before.
      const region = accepted.includes(selected) ? selected : accepted[0];
      if (region) {
        keep(region, key);
        setOutcome({ kind: 'saved', region });
      } else if (unreachable.length > 0) {
        keep(selected, key);
        setOutcome({ kind: 'unreachable', region: selected });
      } else {
        setOutcome({ kind: 'refused' });
        return;
      }
      if (region === selected || !region) {
        const answer = await useProviderStore.getState().refreshReadiness(provider, auth);
        onChecked?.(answer);
      }
    } finally {
      setBusy(false);
    }
  };

  // A key says what its check found, for the selected region (the one checked): saved is not working (Rudolf's review).
  const keyState = (r: SonioxRegion) => {
    if (!keyOf(r)) return t('settingsPage.accounts.soniox.noKey', 'no key');
    if (r !== selected) return t('settingsPage.accounts.soniox.keySaved', 'key saved');
    if (readiness?.state === 'ready') return t('settingsPage.accounts.soniox.keyWorks', 'key works');
    if (readiness?.state === 'not-ready' && readiness.code === 'auth') return t('settingsPage.accounts.soniox.keyRefused', 'key refused');
    return t('settingsPage.accounts.soniox.keyUnverified', 'key saved, not verified yet');
  };

  // The selected region with no key while another has one: offer that one (the first in the usual order).
  const keyed = SONIOX_REGIONS.filter((r) => keyOf(r) !== '');
  const elsewhere = keyOf(selected) === '' ? keyed[0] : undefined;
  const switchTo = (to: SonioxRegion) => { void requestRegionChange({ providerId: provider.id, to, origin: 'select', auth }); };

  return (
    <div className="soniox-key">
      <ul className="soniox-key__regions" aria-label={t('settingsPage.accounts.soniox.byRegion', 'Keys by region')}>
        {SONIOX_REGIONS.map((r) => (
          <li key={r} className={r === selected ? 'is-selected' : undefined}>
            {label(r)}: {keyState(r)}
            {r === selected && ` ${t('settingsPage.accounts.soniox.selected', '(selected)')}`}
          </li>
        ))}
      </ul>
      <div className="api-key-input-group">
        <input type="password" className="api-key-input" value={draft} disabled={disabled}
          aria-label={t('setup.credentials.apiKey', 'API Key')} placeholder={t('providers.soniox.apiKeyPlaceholder', 'Soniox API key')}
          onChange={(e) => setDraft(e.target.value)} />
        <button type="button" className="validate-button" disabled={disabled || busy || draft.trim() === ''} onClick={() => void save()}>
          {busy ? <span className="spinner" aria-hidden="true" /> : t('settingsPage.accounts.soniox.save', 'Save and find its region')}
        </button>
      </div>
      {busy && <p className="soniox-key__note">{t('settingsPage.accounts.soniox.finding', 'Finding the region of this key…')}</p>}
      {outcome && (
        <p className={`soniox-key__note${outcome.kind === 'refused' ? ' is-error' : ''}`} role="status">
          {outcome.kind === 'saved' ? t('settingsPage.accounts.soniox.savedFor', 'This key belongs to {{region}}: saved there.', { region: label(outcome.region) })
            : outcome.kind === 'unreachable' ? t('settingsPage.accounts.soniox.unreachable', 'Could not ask Soniox which region this key belongs to; saved for {{region}}, the region selected now.', { region: label(outcome.region) })
              : t('settingsPage.accounts.soniox.refused', 'No Soniox region accepts this key. Check that it is a Soniox API key.')}
        </p>
      )}
      {elsewhere && (
        <p className="soniox-key__switch">
          <span>{t('settingsPage.accounts.soniox.elsewhere', '{{selected}} is selected, but your key is for {{region}}.', { selected: label(selected), region: label(elsewhere) })}</span>
          <button type="button" className="model-row__btn model-row__btn--primary" disabled={disabled} onClick={() => switchTo(elsewhere)}>
            {t('settingsPage.accounts.soniox.switchTo', 'Switch to {{region}}', { region: label(elsewhere) })}
          </button>
        </p>
      )}
      {readiness?.state === 'not-ready' && keyOf(selected) !== '' && (
        <div className="validation-message error">{noticeText(t, { code: readiness.code, params: readiness.params, message: readiness.reason })}</div>
      )}
    </div>
  );
}
