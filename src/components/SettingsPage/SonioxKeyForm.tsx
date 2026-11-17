// src/components/SettingsPage/SonioxKeyForm.tsx
//
// Soniox's own key on the accounts page. A Soniox key belongs to one region's project and works there only, and
// nobody should have to know which region theirs came from: a pasted key is tried in every region (B-11). The row
// says only which region the key belongs to — no list of regions, no word about the others — the region follows the
// key, and one key is kept (B-39, the owner, 2026-11-17).
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { currentRunPhase } from '../../app/runPhase';
import type { AnyProvider, AuthContext } from '../../lib/provider/types';
import { requestRegionChange } from '../../lib/region/regionChange';
import { asSonioxRegion, SONIOX_REGION_LABELS, SONIOX_REGIONS, type SonioxRegion } from '../../lib/soniox/regions';
import { noticeText } from '../../lib/view/noticeText';
import { regionsAccepting, type KeyRegions } from '../../providers/soniox/keyRegion';
import { SONIOX_KEY_FIELD, type SonioxSettings } from '../../providers/soniox/settings';
import { useProviderStore } from '../../stores/providerStore';

type Outcome =
  | { kind: 'switched'; region: SonioxRegion }
  | { kind: 'refused' }
  | { kind: 'unreachable'; region: SonioxRegion };

type Readiness = Awaited<ReturnType<ReturnType<typeof useProviderStore.getState>['refreshReadiness']>>;

export function SonioxKeyForm({ provider, auth, disabled, detect, onChecked }: {
  provider: AnyProvider;
  auth: AuthContext;
  disabled: boolean;
  /** Which regions accept a key; the regions themselves are asked unless a test says otherwise. */
  detect?: (key: string) => Promise<KeyRegions>;
  /** Called with the selected region's check, once a key is kept for it. */
  onChecked?: (answer: Readiness) => void;
}) {
  const { t } = useTranslation();
  const entry = useProviderStore((s) => s.entries[provider.id]);
  const readiness = useProviderStore((s) => s.readiness[provider.id]);
  const settings = entry?.settings as SonioxSettings | undefined;
  const credentials = (entry?.credentials ?? {}) as Record<string, string>;
  const selected = asSonioxRegion(settings?.region);
  const keyOf = (r: SonioxRegion) => (credentials[SONIOX_KEY_FIELD[r]] ?? '').trim();
  // The key shown: the selected region's; failing that, one an older version kept for another region.
  const keyRegion = keyOf(selected) ? selected : SONIOX_REGIONS.find((r) => keyOf(r) !== '');
  const [draft, setDraft] = useState(() => (keyRegion ? keyOf(keyRegion) : ''));
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // A region change this form made itself: the field and the note it just wrote stay.
  const switching = useRef(false);
  useEffect(() => {
    if (switching.current) { switching.current = false; return; }
    setDraft(keyRegion ? keyOf(keyRegion) : '');
    setOutcome(null);
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!entry || !settings) return null;
  const label = (r: SonioxRegion) => SONIOX_REGION_LABELS[r];
  const store = () => useProviderStore.getState();
  // Run the check whether or not anyone listens: `onChecked?.(await …)` would skip the check itself when no one does.
  const check = async () => { const answer = await store().refreshReadiness(provider, auth); onChecked?.(answer); };
  // Every region's key but `region`'s emptied, as stored now: a save outlives the render it started in.
  const emptyOthers = (region: SonioxRegion) => {
    const stored = (store().entries[provider.id]?.credentials ?? {}) as Record<string, string>;
    for (const r of SONIOX_REGIONS) if (r !== region && (stored[SONIOX_KEY_FIELD[r]] ?? '') !== '') store().setCredential(provider, SONIOX_KEY_FIELD[r], '');
  };
  // One key: kept for `region`, every other region's emptied.
  const keepOnly = (region: SonioxRegion, key: string) => {
    emptyOthers(region);
    store().setCredential(provider, SONIOX_KEY_FIELD[region], key);
  };
  const switchTo = (to: SonioxRegion) => requestRegionChange({ providerId: provider.id, to, origin: 'select', auth });

  const save = async () => {
    const key = draft.trim();
    if (!key) return;
    setBusy(true);
    setOutcome(null);
    try {
      const { accepted, unreachable } = await (detect ?? ((k) => regionsAccepting(k, settings)))(key);
      // A session that started while Soniox was being asked has locked the keys, and a region changed meanwhile is not
      // the one this save placed the key against: either way, nothing is stored.
      const regionNow = asSonioxRegion((store().entries[provider.id]?.settings as SonioxSettings | undefined)?.region);
      if (currentRunPhase() !== 'idle' || regionNow !== selected) return;
      // Kept where it is accepted, the selected region first; asked nowhere, kept for the selected region, and no other
      // region's key goes for a key nothing vouched for.
      const region = accepted.includes(selected) ? selected : accepted[0];
      if (!region) {
        if (unreachable.length === 0) { setOutcome({ kind: 'refused' }); return; }
        store().setCredential(provider, SONIOX_KEY_FIELD[selected], key);
        setOutcome({ kind: 'unreachable', region: selected });
        await check();
        return;
      }
      if (region === selected) { keepOnly(region, key); await check(); return; }
      // The key works in its own region only: the region follows it (a Soniox voice may be asked about first). The
      // other regions' keys go only once it has: a declined switch leaves the selected region's key working.
      store().setCredential(provider, SONIOX_KEY_FIELD[region], key);
      switching.current = true;
      if (await switchTo(region)) {
        emptyOthers(region);
        setOutcome({ kind: 'switched', region });
      } else {
        switching.current = false;
      }
      await check();
    } finally {
      setBusy(false);
    }
  };

  const remove = (r: SonioxRegion) => {
    store().setCredential(provider, SONIOX_KEY_FIELD[r], '');
    setDraft('');
    setOutcome(null);
    if (r === selected) void check();
  };

  // What the key's check found: only the selected region's key is checked; one kept elsewhere is only saved.
  const keyState = (r: SonioxRegion) => {
    if (r !== selected) return t('settingsPage.accounts.soniox.stateSaved', 'Key saved');
    if (readiness?.state === 'ready') return t('settingsPage.accounts.soniox.stateWorks', 'Key works');
    if (readiness?.state === 'not-ready' && readiness.code === 'auth') return t('settingsPage.accounts.soniox.stateRefused', 'Key refused');
    return t('settingsPage.accounts.soniox.stateUnverified', 'Key saved, not verified yet');
  };

  return (
    <div className="soniox-key">
      <div className="api-key-input-group">
        <input type="password" className="api-key-input" value={draft} disabled={disabled}
          aria-label={t('setup.credentials.apiKey', 'API Key')} placeholder={t('providers.soniox.apiKeyPlaceholder', 'Soniox API key')}
          onChange={(e) => setDraft(e.target.value)} />
        <button type="button" className="validate-button" disabled={disabled || busy || draft.trim() === ''} onClick={() => void save()}>
          {busy ? <span className="spinner" aria-hidden="true" /> : t('settingsPage.accounts.soniox.save', 'Save and find its region')}
        </button>
      </div>
      {keyRegion && !busy && (
        <p className={`soniox-key__line${keyRegion === selected && readiness?.state === 'ready' ? ' is-ok' : ''}`}>
          <span>
            {keyState(keyRegion)}
            {' · '}
            {t('settingsPage.accounts.soniox.belongsTo', 'Belongs to {{region}}', { region: label(keyRegion) })}
          </span>
          <button type="button" className="soniox-key__remove" disabled={disabled} onClick={() => remove(keyRegion)}
            aria-label={t('settingsPage.accounts.soniox.removeFor', 'Remove the key for {{region}}', { region: label(keyRegion) })}>
            {t('settingsPage.accounts.soniox.remove', 'Remove')}
          </button>
          {keyRegion !== selected && (
            <button type="button" className="model-row__btn model-row__btn--primary" disabled={disabled} onClick={() => void switchTo(keyRegion)}>
              {t('settingsPage.accounts.soniox.switchTo', 'Switch to {{region}}', { region: label(keyRegion) })}
            </button>
          )}
        </p>
      )}
      {busy && <p className="soniox-key__note">{t('settingsPage.accounts.soniox.finding', 'Finding the region of this key…')}</p>}
      {outcome && (
        <p className={`soniox-key__note${outcome.kind === 'refused' ? ' is-error' : ''}`} role="status">
          {outcome.kind === 'switched' ? t('settingsPage.accounts.soniox.switched', 'Switched to {{region}}: this key works there only.', { region: label(outcome.region) })
            : outcome.kind === 'unreachable' ? t('settingsPage.accounts.soniox.unreachable', 'Could not ask Soniox which region this key belongs to; saved for {{region}}, the region selected now.', { region: label(outcome.region) })
              : t('settingsPage.accounts.soniox.refused', 'No Soniox region accepts this key. Check that it is a Soniox API key.')}
        </p>
      )}
      {readiness?.state === 'not-ready' && keyOf(selected) !== '' && (
        <div className="validation-message error">{noticeText(t, { code: readiness.code, params: readiness.params, message: readiness.reason })}</div>
      )}
    </div>
  );
}
