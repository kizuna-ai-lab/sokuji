// src/components/SettingsPage/AccountsCategory.tsx
//
// "Accounts and keys": one row per account the user fills in, not per
// provider: one Kizuna AI sign-in for both hosted providers, one OpenAI key
// for the three OpenAI providers (Plan 4), one row each for the other
// providers with a key, and the ones that need none. Which provider serves a
// stage is chosen in "Languages and line-up", never here.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnalytics } from '../../lib/analytics';
import { caps } from '../../lib/lineup/catalog';
import { RUN_STAGES, type RunStage } from '../../lib/lineup/types';
import type { AnyProvider } from '../../lib/provider/types';
import { presentProviders } from '../../providers/registry';
import { useProviderStore } from '../../stores/providerStore';
import { CredentialForm } from '../providers/CredentialForm';
import { ManagedAccountRow } from '../providers/ManagedAccountRow';
import { useAuthContext } from '../providers/useAuthContext';
import type { CategoryBodyProps } from './SettingsPage';

const OPENAI_IDS = ['openai', 'openai_translate', 'openai_live'];
const STAGE_TITLES: Record<RunStage, string> = { transcription: 'Transcription', translation: 'Translation', speech: 'Speech' };

interface Account {
  key: string;
  name: string;
  kind: 'kizuna' | 'key' | 'local' | 'online';
  /** The provider whose credential form the row opens. */
  provider?: AnyProvider;
  /** The provider ids the account serves, for its chips. */
  serves: readonly string[];
}

export function AccountsCategory({ locked, openedBy = null }: CategoryBodyProps) {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const auth = useAuthContext();
  const providers = useMemo(() => presentProviders(), []);
  const entries = useProviderStore((s) => s.entries);
  const readiness = useProviderStore((s) => s.readiness);
  const [open, setOpen] = useState<string | null>(null);

  // Opened by a notice or the tour about a key or a sign-in: the selected provider's account is shown open.
  useEffect(() => {
    if (openedBy === 'user-account') { setOpen('kizuna'); return; }
    if (openedBy !== 'provider') return;
    const p = providers.find((x) => x.id === useProviderStore.getState().selected);
    if (p?.kind === 'managed') setOpen('kizuna');
    else if (p?.kind === 'own-key') setOpen(OPENAI_IDS.includes(p.id) ? 'openai' : p.id);
  }, [openedBy, providers]);

  // Every provider with a key is loaded, so its row can say whether the key is there.
  useEffect(() => {
    for (const p of providers) if (p.kind === 'own-key' && !useProviderStore.getState().entries[p.id]) void useProviderStore.getState().load(p);
  }, [providers]);

  const accounts = useMemo<Account[]>(() => {
    const list: Account[] = [];
    const managed = providers.filter((p) => p.kind === 'managed');
    if (managed.length) list.push({ key: 'kizuna', name: 'Kizuna AI', kind: 'kizuna', serves: managed.map((p) => p.id) });
    const openai = providers.filter((p) => OPENAI_IDS.includes(p.id));
    let openaiListed = false;
    for (const p of providers) {
      if (p.kind !== 'own-key') continue;
      if (OPENAI_IDS.includes(p.id)) {
        if (openaiListed) continue;
        openaiListed = true;
        // One key for the three (Plan 4): the row edits it through the first present OpenAI provider.
        list.push({ key: 'openai', name: 'OpenAI', kind: 'key', provider: openai[0], serves: openai.map((x) => x.id) });
        continue;
      }
      list.push({ key: p.id, name: t(`providers.${p.id}.name`, p.id), kind: 'key', provider: p, serves: [p.id] });
    }
    if (providers.some((p) => p.id === 'local_inference')) {
      list.push({ key: 'local_inference', name: t('providers.local_inference.name', 'This device'), kind: 'local', serves: ['local_inference'] });
      list.push({ key: 'bing', name: t('providers.bing.name', 'Bing'), kind: 'online', serves: ['bing'] });
      list.push({ key: 'edge', name: t('providers.edge.name', 'Edge'), kind: 'online', serves: ['edge'] });
    }
    return list;
  }, [providers, t]);

  const keySaved = (p: AnyProvider | undefined) => {
    const entry = p ? entries[p.id] : undefined;
    if (!p || !entry) return false;
    return p.credentials.fields(entry.settings as never).every((f) => String(entry.credentials[f.key] ?? '').trim() !== '');
  };

  const stateOf = (a: Account): string => {
    switch (a.kind) {
      case 'kizuna': return auth.signedIn ? t('settingsPage.accounts.signedIn', 'Signed in') : t('settingsPage.accounts.signedOut', 'Not signed in');
      case 'key': return keySaved(a.provider) ? t('settingsPage.accounts.keySaved', 'Key saved') : t('settingsPage.accounts.needsKey', 'Needs a key');
      case 'local': return t('settingsPage.accounts.local', 'Runs on this computer');
      case 'online': return t('settingsPage.accounts.online', 'No key needed; online, a Microsoft service');
    }
  };

  const chips = (a: Account) => {
    const stages = RUN_STAGES.filter((s) => a.serves.some((id) => caps(id)?.stages.includes(s)));
    const together = a.serves.some((id) => (caps(id)?.binds ?? []).some((g) => g.length > 1));
    return (
      <span className="accounts-row__chips">
        {stages.map((s) => <span className="accounts-row__chip" key={s}>{t(`settingsPage.lineup.stages.${s}`, STAGE_TITLES[s])}</span>)}
        {together && <span className="accounts-row__chip">{t('settingsPage.accounts.together', 'together')}</span>}
      </span>
    );
  };

  return (
    <div className="config-section accounts-category" id="provider-section" data-tour="provider-section">
      {accounts.map((a) => {
        const p = a.provider;
        const entry = p ? entries[p.id] : undefined;
        const isOpen = open === a.key;
        const editable = a.kind === 'kizuna' || a.kind === 'key';
        return (
          <div className="accounts-row" role="group" aria-label={a.name} key={a.key} id={a.kind === 'kizuna' ? 'user-account-section' : undefined}>
            <div className="accounts-row__head">
              <span className="accounts-row__name">{a.name}</span>
              <span className="accounts-row__state">{stateOf(a)}</span>
              {chips(a)}
              {editable && (
                <button type="button" className="accounts-row__toggle" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : a.key)}>
                  {a.kind === 'key' && !keySaved(p) ? t('settingsPage.accounts.addKey', 'Add key') : t('settingsPage.accounts.view', 'View')}
                </button>
              )}
            </div>
            {isOpen && a.kind === 'kizuna' && <ManagedAccountRow auth={auth} />}
            {isOpen && a.kind === 'key' && p && entry && (
              <CredentialForm
                fields={p.credentials.fields(entry.settings as never)}
                values={entry.credentials}
                readiness={readiness[p.id] ?? { state: 'unknown' }}
                onChange={(key, value) => useProviderStore.getState().setCredential(p, key, value)}
                choice={p.credentials.choice && {
                  options: p.credentials.choice.options,
                  value: String((entry.settings as Record<string, unknown>)[p.credentials.choice.setting] ?? ''),
                  onChange: (value) => useProviderStore.getState().updateSettings(p, { [p.credentials.choice!.setting]: value }),
                }}
                onCheck={() => {
                  void useProviderStore.getState().refreshReadiness(p, auth).then((answer) => {
                    if (answer.state === 'unknown' || answer.state === 'checking') return;
                    trackEvent('api_key_validated', {
                      provider: p.id,
                      success: answer.state === 'ready',
                      ...(answer.state === 'not-ready' && answer.code ? { error_type: answer.code } : {}),
                    });
                  });
                }}
                disabled={locked}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
