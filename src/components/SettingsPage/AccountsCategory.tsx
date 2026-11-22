// src/components/SettingsPage/AccountsCategory.tsx
//
// "Accounts and keys": one row per account the user fills in, not per
// provider: one Kizuna AI sign-in for both hosted providers, one OpenAI key
// for the three OpenAI providers (Plan 4), one row each for the other
// providers with a key, and the ones that need none. Which provider serves a
// stage is chosen in "Languages and line-up", never here.
import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { ExternalLink } from 'lucide-react';
import { openExternalUrl } from '../../utils/openExternalUrl';
import { useTranslation } from 'react-i18next';
import { useAnalytics } from '../../lib/analytics';
import { caps, carriedTogether } from '../../lib/lineup/catalog';
import { RUN_STAGES, type RunStage } from '../../lib/lineup/types';
import { planFromStores } from '../../lib/plan/fromStores';
import { transcriptionProvider } from '../../lib/plan/read';
import type { AnyProvider } from '../../lib/provider/types';
import { presentProviders } from '../../providers/registry';
import { stageProviderId } from '../../stores/lineUpStore';
import { useProviderStore } from '../../stores/providerStore';
import { useModelStore, useModelStatuses, useStorageUsedMb } from '../../stores/modelStore';
import { useAccountStore } from '../../stores/accountStore';
import { useNavigateToSettings } from '../../stores/settingsStore';
import { payerDisplayBalance } from '../../lib/session/orgNotice';
import { useOptionalUserProfile } from '../../contexts/UserProfileContext';
import { MODEL_MANIFEST } from '../../lib/local-inference/modelManifest';
import { formatBytes } from '../../lib/local-inference/formatBytes';
import { formatUsdFloor } from '../../utils/formatters';
import { describeCause, reportWarning } from '../../lib/diagnostics/report';
import { CredentialForm } from '../providers/CredentialForm';
import { BingIcon, EdgeIcon, KizunaAIIcon } from '../Icons/ProviderIcons';
import { SonioxKeyForm } from './SonioxKeyForm';
import { ManagedAccountRow } from '../providers/ManagedAccountRow';
import { UserAccountInfo } from '../Auth/UserAccountInfo';
import { useRunState } from '../../app/useRun';
import { useShownPayer } from '../../app/useShownPayer';
import { useAuthContext } from '../providers/useAuthContext';
import type { CategoryBodyProps } from './SettingsPage';
import { accountAnchor, accountKeyOf, providerOfTarget } from './accountRows';
import { FindModels } from './FindModels';

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
  /** Its logo, the one the line-up's service picker shows (owner, 2026-11-19: found at a glance in the list). */
  icon?: ComponentType<{ size?: string | number }>;
}

export function AccountsCategory({ locked, openedBy = null }: CategoryBodyProps) {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const auth = useAuthContext();
  const providers = useMemo(() => presentProviders(), []);
  const entries = useProviderStore((s) => s.entries);
  const readiness = useProviderStore((s) => s.readiness);
  const [open, setOpen] = useState<string | null>(null);
  const navigateToSettings = useNavigateToSettings();
  // The balance the title bar shows: a member's wallet the next Start spends, else the account's own.
  const quota = useOptionalUserProfile()?.quota;
  const account = useAccountStore((s) => s.account);
  // The row and the account panel show the wallet the title bar shows (useShownPayer).
  const run = useRunState();
  const payer = useShownPayer(account);
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

  // Opened by a notice or the tour about a key or a sign-in: the account of the provider that transcribes is shown open.
  useEffect(() => {
    if (openedBy === 'user-account') { setOpen('kizuna'); return; }
    // One provider's key, named by the link that opened the page (owner, 2026-11-17): that provider's row, whatever the session runs on.
    const named = providerOfTarget(openedBy);
    if (named) { setOpen(accountKeyOf(named)); return; }
    if (openedBy !== 'provider') return;
    // The plan's transcription provider; while the plan loads or is refused, the provider the line-up names for it.
    const found = planFromStores();
    const id = found.state === 'ready' ? transcriptionProvider(found.plan).id : stageProviderId('transcription');
    const p = providers.find((x) => x.id === id);
    if (p?.kind === 'managed') setOpen('kizuna');
    else if (p?.kind === 'own-key') setOpen(accountKeyOf(p.id));
  }, [openedBy, providers]);

  // Every provider with a key is loaded, so its row can say whether the key is there.
  useEffect(() => {
    for (const p of providers) if (p.kind === 'own-key' && !useProviderStore.getState().entries[p.id]) void useProviderStore.getState().load(p);
  }, [providers]);

  const accounts = useMemo<Account[]>(() => {
    const list: Account[] = [];
    const managed = providers.filter((p) => p.kind === 'managed');
    if (managed.length) list.push({ key: 'kizuna', name: 'Kizuna AI', kind: 'kizuna', serves: managed.map((p) => p.id), guide: managed.find((p) => p.guideUrl)?.guideUrl, icon: KizunaAIIcon });
    // The accounts that need no key come first (the mock's order), then the providers with a key.
    const local = providers.find((p) => p.id === 'local_inference');
    if (local) {
      list.push({ key: 'local_inference', name: t('providers.local_inference.name', 'This device'), kind: 'local', serves: ['local_inference'], guide: local.guideUrl, icon: local.icon });
      list.push({ key: 'bing', name: t('providers.bing.name', 'Bing'), kind: 'online', serves: ['bing'], icon: BingIcon });
      list.push({ key: 'edge', name: t('providers.edge.name', 'Edge'), kind: 'online', serves: ['edge'], icon: EdgeIcon });
    }
    // One row per key: the providers that share one (OpenAI's, Gemini's) are one row, edited through the first present
    // one of them, and showing what each can do.
    const listed = new Set<string>();
    for (const p of providers) {
      if (p.kind !== 'own-key') continue;
      const key = accountKeyOf(p.id);
      if (listed.has(key)) continue;
      listed.add(key);
      const sharing = providers.filter((x) => x.kind === 'own-key' && accountKeyOf(x.id) === key);
      const name = key === 'openai' ? 'OpenAI' : t(`providers.${key}.name`, key);
      list.push({ key, name, kind: 'key', provider: sharing[0], serves: sharing.map((x) => x.id), guide: sharing.find((x) => x.guideUrl)?.guideUrl, icon: sharing[0].icon });
    }
    return list;
  }, [providers, t]);

  /**
   * The fields of a provider's key that are still empty; one that may stay empty (a compatible service's key) never is.
   * Nothing stored yet: every field its default settings ask for (a compatible service's address first).
   */
  const unfilled = (p: AnyProvider | undefined) => {
    if (!p) return [{ key: 'apiKey' }];
    const entry = entries[p.id];
    return p.credentials.fields((entry?.settings ?? p.settings.defaults) as never)
      .filter((f) => !f.optional && String(entry?.credentials[f.key] ?? '').trim() === '');
  };
  const keySaved = (p: AnyProvider | undefined) => unfilled(p).length === 0;

  const stateOf = (a: Account): string => {
    switch (a.kind) {
      case 'kizuna':
        if (!auth.signedIn) return t('settingsPage.accounts.signedOut', 'Not signed in');
        return typeof balance === 'number'
          ? t('settingsPage.accounts.signedInBalance', 'Signed in; balance {{amount}}', { amount: formatUsdFloor(balance) })
          : t('settingsPage.accounts.signedIn', 'Signed in');
      case 'key': {
        if (unfilled(a.provider).some((f) => f.key === 'baseUrl')) return t('settingsPage.lineup.state.needsAddress', 'Needs an address');
        if (!keySaved(a.provider)) return t('settingsPage.accounts.needsKey', 'Needs a key');
        // Saved is not working (Rudolf's review of B-11): the row says what the key's check found.
        const r = a.provider ? readiness[a.provider.id] : undefined;
        if (r?.state === 'ready') return t('settingsPage.accounts.keySaved', 'Key saved');
        if (r?.state === 'not-ready' && r.code === 'auth') return t('settingsPage.lineup.state.keyRefused', 'Key not accepted');
        return t('settingsPage.lineup.state.keyNotVerified', 'Key not verified');
      }
      case 'local':
        return localModels > 0
          ? t('settingsPage.accounts.localModels', 'Runs on this computer; {{count}} models downloaded, {{size}} in all', { count: localModels, size: formatBytes(storageMb * 1_048_576) })
          : t('settingsPage.accounts.localNone', 'Runs on this computer; no models downloaded yet');
      case 'online': return t('settingsPage.accounts.online', 'No key needed; online, a Microsoft service');
    }
  };

  /** An account in working order: signed in, its key saved, or one that needs neither. */
  const ready = (a: Account): boolean => (a.kind === 'kizuna' ? auth.signedIn
    : a.kind === 'key' ? keySaved(a.provider) && readiness[a.provider?.id ?? '']?.state === 'ready' : true);

  // The mock's tags: one per way the account works — what it does over one connection ("End to end",
  // "Transcription and translation"), else each stage on its own; each tag once across the account's providers.
  const chips = (a: Account) => {
    const labels: string[] = [];
    const add = (label: string) => { if (!labels.includes(label)) labels.push(label); };
    const stageName = (s: RunStage) => t(`settingsPage.lineup.stages.${s}`, STAGE_TITLES[s]);
    for (const id of a.serves) {
      const c = caps(id);
      if (!c) continue;
      // What one connection of it carries: an end-to-end provider's three stages, or Soniox's transcription and translation.
      const together = carriedTogether(c);
      const groups = together && together.length > 1 ? [together] : [];
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
        const Icon = a.icon;
        return (
          <div className="accounts-row" role="group" aria-label={a.name} key={a.key} id={`${accountAnchor(a.key)}-section`}>
            {/* The mock's row: the name with what the account can do beside it (owner, 2026-11-15: no need to open
                the row to see them), its state under it, one button. */}
            <div className="accounts-row__head">
              {Icon && <span className="accounts-row__icon" aria-hidden="true"><Icon size={20} /></span>}
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
              {/* A row opens only where there is something to fill in (owner, 2026-11-22): a sign-in or a key. This
                  device's models are set up in Models and storage, so its button goes there; Bing and Edge need
                  nothing, and their line says so. */}
              {a.kind === 'local' ? (
                <button type="button" className="accounts-row__toggle" onClick={() => navigateToSettings('models')}>
                  {t('settingsPage.accounts.manageModels', 'Manage models')}
                </button>
              ) : a.kind !== 'online' && (
                <button type="button" className="accounts-row__toggle" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : a.key)}>
                  {isOpen ? t('settingsPage.accounts.hide', 'Hide')
                    // The compatible service is set up by its address first, and its key may be none: it is configured, not keyed.
                    : a.kind === 'key' && !keySaved(p) ? (p?.id === 'openai_compatible' ? t('settingsPage.accounts.configure', 'Configure') : t('settingsPage.accounts.addKey', 'Add key'))
                      : t('settingsPage.accounts.view', 'View')}
                </button>
              )}
            </div>
            {/* Signed in, the title bar's account panel (owner, 2026-11-15): the balance, the organization's too, and
                the dashboard, sign-out, feedback and top-up; else the sign-in. */}
            {isOpen && a.kind === 'kizuna' && (auth.signedIn
              ? <div className="accounts-row__account"><UserAccountInfo idle={run.phase === 'idle'} runPayer={run.phase === 'idle' ? undefined : payer} /></div>
              : <ManagedAccountRow auth={auth} />)}
            {/* Soniox's key is kept by region, found by asking every region (B-11). */}
            {isOpen && a.kind === 'key' && p && entry && p.id === 'soniox' && (
              <SonioxKeyForm provider={p} auth={auth} disabled={locked}
                onChecked={(answer) => {
                  if (answer.state === 'unknown' || answer.state === 'checking') return;
                  trackEvent('api_key_validated', {
                    provider: p.id,
                    success: answer.state === 'ready',
                    ...(answer.state === 'not-ready' && answer.code ? { error_type: answer.code } : {}),
                  });
                }} />
            )}
            {isOpen && a.kind === 'key' && p && entry && p.id !== 'soniox' && (
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
            {/* A compatible service's models, asked with the address and key as they stand (spec 2026-11-22 §7). */}
            {isOpen && a.kind === 'key' && p && entry && p.id === 'openai_compatible' && (
              <FindModels service="compatible" credentials={entry.credentials} disabled={locked} />
            )}
          </div>
        );
      })}
    </div>
  );
}
