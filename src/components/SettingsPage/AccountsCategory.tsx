// src/components/SettingsPage/AccountsCategory.tsx
//
// "Accounts and keys": one row per account the user fills in, not per
// provider: one Kizuna AI sign-in for both hosted providers, one OpenAI key
// for the three OpenAI providers (Plan 4), one row each for the other
// providers with a key, and the ones that need none. Which provider serves a
// stage is chosen in "Languages and line-up", never here.
import { useEffect, useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { openExternalUrl } from '../../utils/openExternalUrl';
import { useTranslation } from 'react-i18next';
import { useAnalytics } from '../../lib/analytics';
import { caps } from '../../lib/lineup/catalog';
import { RUN_STAGES, type RunStage } from '../../lib/lineup/types';
import type { AnyProvider } from '../../lib/provider/types';
import { presentProviders } from '../../providers/registry';
import { useProviderStore } from '../../stores/providerStore';
import { useModelStore, useModelStatuses, useStorageUsedMb } from '../../stores/modelStore';
import { useAccountStore } from '../../stores/accountStore';
import { useAccountPayer } from '../../lib/session/payerChoice';
import { payerDisplayBalance } from '../../lib/session/orgNotice';
import { useOptionalUserProfile } from '../../contexts/UserProfileContext';
import { MODEL_MANIFEST } from '../../lib/local-inference/modelManifest';
import { formatBytes } from '../../lib/local-inference/formatBytes';
import { formatUsdFloor } from '../../utils/formatters';
import { describeCause, reportWarning } from '../../lib/diagnostics/report';
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
  /** The provider's setup guide on the website, when it has one. */
  guide?: string;
}

export function AccountsCategory({ locked, openedBy = null }: CategoryBodyProps) {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const auth = useAuthContext();
  const providers = useMemo(() => presentProviders(), []);
  const entries = useProviderStore((s) => s.entries);
  const readiness = useProviderStore((s) => s.readiness);
  const [open, setOpen] = useState<string | null>(null);
  // The balance the title bar shows: a member's wallet the next Start spends, else the account's own.
  const quota = useOptionalUserProfile()?.quota;
  const account = useAccountStore((s) => s.account);
  const payer = useAccountPayer(account);
  const balance = account?.status === 'known' && account.organization ? payerDisplayBalance(account, payer) : quota?.balance ?? quota?.remaining;
  // This device's models: how many are on disk, known once the store has looked.
  const statuses = useModelStatuses();
  const storageMb = useStorageUsedMb();
  useEffect(() => {
    if (useModelStore.getState().initialized) return;
    useModelStore.getState().initialize().catch((error: unknown) =>
      reportWarning('AccountsCategory', `Scanning the downloaded models failed: ${describeCause(error)}`, { cause: error }));
  }, []);
  const localModels = MODEL_MANIFEST.filter((m) => !m.isCloudModel && m.type !== 'punctuation' && m.type !== 'turn' && statuses[m.id] === 'downloaded').length;

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
    if (managed.length) list.push({ key: 'kizuna', name: 'Kizuna AI', kind: 'kizuna', serves: managed.map((p) => p.id), guide: managed.find((p) => p.guideUrl)?.guideUrl });
    // The accounts that need no key come first (the mock's order), then the providers with a key.
    if (providers.some((p) => p.id === 'local_inference')) {
      list.push({ key: 'local_inference', name: t('providers.local_inference.name', 'This device'), kind: 'local', serves: ['local_inference'], guide: providers.find((p) => p.id === 'local_inference')?.guideUrl });
      list.push({ key: 'bing', name: t('providers.bing.name', 'Bing'), kind: 'online', serves: ['bing'] });
      list.push({ key: 'edge', name: t('providers.edge.name', 'Edge'), kind: 'online', serves: ['edge'] });
    }
    const openai = providers.filter((p) => OPENAI_IDS.includes(p.id));
    let openaiListed = false;
    for (const p of providers) {
      if (p.kind !== 'own-key') continue;
      if (OPENAI_IDS.includes(p.id)) {
        if (openaiListed) continue;
        openaiListed = true;
        // One key for the three (Plan 4): the row edits it through the first present OpenAI provider.
        list.push({ key: 'openai', name: 'OpenAI', kind: 'key', provider: openai[0], serves: openai.map((x) => x.id), guide: openai.find((x) => x.guideUrl)?.guideUrl });
        continue;
      }
      list.push({ key: p.id, name: t(`providers.${p.id}.name`, p.id), kind: 'key', provider: p, serves: [p.id], guide: p.guideUrl });
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
      case 'kizuna':
        if (!auth.signedIn) return t('settingsPage.accounts.signedOut', 'Not signed in');
        return typeof balance === 'number'
          ? t('settingsPage.accounts.signedInBalance', 'Signed in; balance {{amount}}', { amount: formatUsdFloor(balance) })
          : t('settingsPage.accounts.signedIn', 'Signed in');
      case 'key': return keySaved(a.provider) ? t('settingsPage.accounts.keySaved', 'Key saved') : t('settingsPage.accounts.needsKey', 'Needs a key');
      case 'local':
        return localModels > 0
          ? t('settingsPage.accounts.localModels', 'Runs on this computer; {{count}} models downloaded, {{size}} in all', { count: localModels, size: formatBytes(storageMb * 1_048_576) })
          : t('settingsPage.accounts.localNone', 'Runs on this computer; no models downloaded yet');
      case 'online': return t('settingsPage.accounts.online', 'No key needed; online, a Microsoft service');
    }
  };

  /** An account in working order: signed in, its key saved, or one that needs neither. */
  const ready = (a: Account): boolean => (a.kind === 'kizuna' ? auth.signedIn : a.kind === 'key' ? keySaved(a.provider) : true);

  // The mock's tags: one per way the account works — what it does over one connection ("End to end",
  // "Transcription and translation"), else each stage on its own; each tag once across the account's providers.
  const chips = (a: Account) => {
    const labels: string[] = [];
    const add = (label: string) => { if (!labels.includes(label)) labels.push(label); };
    const stageName = (s: RunStage) => t(`settingsPage.lineup.stages.${s}`, STAGE_TITLES[s]);
    for (const id of a.serves) {
      const c = caps(id);
      if (!c) continue;
      const groups = c.binds.filter((g) => g.length > 1);
      for (const g of groups) {
        add(g.length >= RUN_STAGES.length ? t('settingsPage.accounts.endToEnd', 'End to end')
          : g.includes('transcription') && g.includes('translation') && g.length === 2 ? t('settingsPage.accounts.transcribeTranslate', 'Transcription and translation')
            : (g as RunStage[]).map(stageName).join(t('settingsPage.lineup.and', ' and ')));
      }
      for (const s of RUN_STAGES) if (c.stages.includes(s) && !groups.some((g) => g.includes(s))) add(stageName(s));
    }
    return (
      <span className="accounts-row__chips">
        {labels.map((label) => <span className="accounts-row__chip" key={label}>{label}</span>)}
      </span>
    );
  };

  return (
    <div className="config-section accounts-category" id="provider-section" data-tour="provider-section">
      {accounts.map((a) => {
        const p = a.provider;
        const entry = p ? entries[p.id] : undefined;
        const isOpen = open === a.key;
        return (
          <div className="accounts-row" role="group" aria-label={a.name} key={a.key} id={a.kind === 'kizuna' ? 'user-account-section' : undefined}>
            {/* The mock's row: the name with what the account can do beside it (owner, 2026-11-15: no need to open
                the row to see them), its state under it, one button. */}
            <div className="accounts-row__head">
              <div className="accounts-row__main">
                <span className="accounts-row__title">
                  <span className="accounts-row__name">{a.name}</span>
                  {chips(a)}
                </span>
                <span className={`accounts-row__state${ready(a) ? ' is-ok' : ''}`}>
                  {stateOf(a)}
                  {a.guide && (
                    <a className="accounts-row__guide" href={a.guide} onClick={(e) => { e.preventDefault(); openExternalUrl(a.guide!); }}>
                      <ExternalLink size={12} aria-hidden="true" />
                      {t('simpleSettings.setupGuide', 'Setup guide')}
                    </a>
                  )}
                </span>
              </div>
              <button type="button" className="accounts-row__toggle" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : a.key)}>
                {isOpen ? t('settingsPage.accounts.hide', 'Hide')
                  : a.kind === 'key' && !keySaved(p) ? t('settingsPage.accounts.addKey', 'Add key') : t('settingsPage.accounts.view', 'View')}
              </button>
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
