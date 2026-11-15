// src/components/SettingsPage/LineUpCategory.tsx
//
// "Languages and line-up": the language pair, the speech mode, and one row per
// stage choosing the provider that serves it (Plan 4's line-up). Which model or
// setting a provider uses is that provider's own options, folded under the rows.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Link2 } from 'lucide-react';
import { useAnalytics } from '../../lib/analytics';
import { caps } from '../../lib/lineup/catalog';
import { RUN_STAGES, type LineUp, type RunStage, type StageName } from '../../lib/lineup/types';
import { presentProviders } from '../../providers/registry';
import { lineUpChangedEvent, useLineUpStore } from '../../stores/lineUpStore';
import { useProviderStore } from '../../stores/providerStore';
import { useMode } from '../../stores/audioStore';
import { useEngineSlotTarget, useNavigateToSettings, useSetEngineSlotTarget, useSettingsNavigationTarget, useTextOnly } from '../../stores/settingsStore';
import { supportsBaseSelect } from '../../utils/supportsBaseSelect';
import { getManifestEntry } from '../../lib/local-inference/modelManifest';
import { directionKey, type Selections } from '../../lib/local-inference/selection/types';
import { ProviderLanguages } from '../providers/ProviderLanguages';
import { ProviderEngine, ProviderOwnSettings, ProviderTurnDetectionControls } from '../providers/ProviderOwnSettings';
import { ProviderOption, useOptionModel, type ProviderOptionModel } from '../providers/ProviderOption';
import { useAuthContext } from '../providers/useAuthContext';
import { SpeechSection } from '../Settings/sections/SpeechSection';
import type { AnyProvider } from '../../lib/provider/types';
import type { CategoryBodyProps } from './SettingsPage';

const STAGE_TITLES: Record<RunStage, string> = { transcription: 'Transcription', translation: 'Translation', speech: 'Speech' };

/** The navigation targets that live in the folded provider options: they unfold them first. */
const FOLDED_TARGETS = new Set(['provider-options', 'model-management', 'model-asr', 'model-translation', 'model-tts', 'system-instructions', 'voice-settings', 'turn-detection-tuning']);

/**
 * A stage's name inside a sentence ("Goes with translation…"): lower-cased in the reader's language, except where
 * that language writes it capitalised (German nouns).
 */
export function stageInSentence(name: string, language: string): string {
  const tag = language.replace('_', '-');
  return tag.toLowerCase().startsWith('de') ? name : name.toLocaleLowerCase(tag);
}

/** Whether a provider's key or sign-in is in place, as far as this page can tell without a check. */
function credentialsMissing(p: AnyProvider | undefined, signedIn: boolean): 'key' | 'sign-in' | null {
  if (!p) return null;
  if (p.kind === 'managed') return signedIn ? null : 'sign-in';
  if (p.kind !== 'own-key') return null;
  const entry = useProviderStore.getState().entries[p.id];
  if (!entry) return 'key';
  const fields = p.credentials.fields(entry.settings as never);
  return fields.every((f) => String(entry.credentials[f.key] ?? '').trim() !== '') ? null : 'key';
}

export function LineUpCategory({ locked }: CategoryBodyProps) {
  const { t, i18n } = useTranslation();
  const { trackEvent } = useAnalytics();
  const providers = useMemo(() => presentProviders(), []);
  const auth = useAuthContext();
  const mode = useMode();
  const textOnly = useTextOnly();
  const lineUp = useLineUpStore((s) => s.lineUp);
  const entries = useProviderStore((s) => s.entries);
  const readiness = useProviderStore((s) => s.readiness);
  const target = useSettingsNavigationTarget();
  const navigateToSettings = useNavigateToSettings();
  const model = useOptionModel();
  const [rich] = useState(() => supportsBaseSelect());
  const [folded, setFolded] = useState(true);
  // A slot a notice asked for (a voice to fix, #619): the engine opens it, then it is spent.
  const engineSlotTarget = useEngineSlotTarget();
  const setEngineSlotTarget = useSetEngineSlotTarget();
  const [moved, setMoved] = useState<{ stage: StageName; text: string } | null>(null);

  // Every provider with a key is loaded, so that its row can say whether the key is there.
  useEffect(() => {
    for (const p of providers) if (p.kind === 'own-key' && !useProviderStore.getState().entries[p.id]) void useProviderStore.getState().load(p);
  }, [providers]);

  // A target inside the provider's own options unfolds them before the page scrolls to it.
  useEffect(() => {
    if (target && FOLDED_TARGETS.has(target)) setFolded(false);
  }, [target]);
  useEffect(() => {
    if (engineSlotTarget) setFolded(false);
  }, [engineSlotTarget]);

  const offered = useMemo(() => {
    const ids = new Set(providers.map((p) => p.id));
    if (ids.has('local_inference')) { ids.add('bing'); ids.add('edge'); }
    return ids;
  }, [providers]);

  const stageName = (s: StageName) => stageInSentence(t(`settingsPage.lineup.stages.${s}`, STAGE_TITLES[s as RunStage] ?? s), i18n?.language ?? 'en');

  const optionsFor = (stage: RunStage): ProviderOptionModel[] => {
    void entries; // re-render when an entry loads, so the key state is current
    return providers.flatMap((p) => (p.id === 'local_inference' ? [p.id, 'bing', 'edge'] : [p.id]))
      .filter((id) => offered.has(id) && caps(id)?.stages.includes(stage))
      .map((id) => {
        const p = providers.find((x) => x.id === id);
        const missing = credentialsMissing(p, auth.signedIn);
        const m = model(id, p);
        if (missing && lineUp?.[stage] !== id) m.blocked = missing === 'key' ? t('settingsPage.lineup.needsKey', 'needs a key') : t('settingsPage.lineup.needsSignIn', 'needs a sign-in');
        return m;
      });
  };

  const choose = async (stage: RunStage, id: string) => {
    const before: LineUp | null = useLineUpStore.getState().lineUp;
    const choice = await useLineUpStore.getState().choose(stage, id);
    if (!choice || !before) return;
    trackEvent('lineup_changed', lineUpChangedEvent(stage, before, choice));
    // The stages the chosen provider binds are said by the joint line; say only what else moved (owner, 2026-11-15).
    const group = caps(id)?.binds.find((g) => g.includes(stage)) ?? [stage];
    const extra = choice.moved.filter((s) => !group.includes(s as RunStage));
    if (!extra.length) { setMoved(null); return; }
    const names = extra.map((s, i) => (i === 0 ? t(`settingsPage.lineup.stages.${s}`, STAGE_TITLES[s as RunStage]) : stageName(s)));
    const providerNames = [...new Set(extra.map((s) => model(choice.lineUp[s] ?? '', providers.find((p) => p.id === choice.lineUp[s])).name))];
    setMoved({
      stage,
      text: t('settingsPage.lineup.moved', '{{stages}} moved to {{providers}} too: today they cannot be combined with this choice. Mixing comes later.', {
        stages: names.join(t('settingsPage.lineup.and', ' and ')), providers: providerNames.join(t('settingsPage.lineup.and', ' and ')),
      }),
    });
    // A one-shot target that opened this page is spent once something is chosen here.
    if (target) navigateToSettings(null);
  };

  const selectedId = useProviderStore((s) => s.selected);
  const selectedProvider = providers.find((p) => p.id === selectedId);

  /** A row's state: what the chosen provider lacks, or Ready. */
  const stateOf = (id: string): { ok: boolean; text: string } => {
    const p = providers.find((x) => x.id === id) ?? (caps(id)?.family === 'local_inference' ? providers.find((x) => x.id === 'local_inference') : undefined);
    // Bing and Edge are online services of the local family: no key and no model.
    if (id === 'bing' || id === 'edge') return { ok: true, text: t('settingsPage.lineup.state.ready', 'Ready') };
    const missing = credentialsMissing(p, auth.signedIn);
    if (missing === 'key') return { ok: false, text: t('settingsPage.lineup.state.needsKey', 'Needs a key') };
    if (missing === 'sign-in') return { ok: false, text: t('settingsPage.lineup.state.needsSignIn', 'Needs a sign-in') };
    const r = p ? readiness[p.id] : undefined;
    if (p?.kind === 'local' && r?.state === 'not-ready') return { ok: false, text: t('settingsPage.lineup.state.needsModel', 'Needs a model') };
    return { ok: true, text: t('settingsPage.lineup.state.ready', 'Ready') };
  };

  // Granite Speech is a local model: when the local transcription and translation choices are the same Granite
  // Speech model, today's code turns speech straight into the translation (Plan 4, Task 3).
  const graniteDirect = (() => {
    if (lineUp?.transcription !== 'local_inference' || lineUp.translation !== 'local_inference') return false;
    const local = entries.local_inference;
    const selections = (local?.settings as { selections?: Selections } | undefined)?.selections;
    if (!local || !selections) return false;
    const chosen = selections[directionKey(local.pair.source, local.pair.target)];
    const id = chosen?.asr.modelId;
    return Boolean(id) && chosen?.translation.modelId === id && getManifestEntry(id!)?.asrEngine === 'granite-speech';
  })();

  return (
    <div className="lineup-category">
      <ProviderLanguages providers={providers} disabled={locked} sentence={{ mode, textOnly }} heading={false} />
      <SpeechSection locked={locked} />
      <div className="config-section lineup-section" id="lineup-section">
        <h3 className="settings-subhead">
          <span>{t('settingsPage.lineup.title', 'Line-up')}</span>
          <small>{t('settingsPage.lineup.hint', 'Which service does each stage')}</small>
        </h3>
        {RUN_STAGES.map((stage) => {
          const id = lineUp?.[stage] ?? '';
          const group = caps(id)?.binds.find((g) => g.includes(stage) && g.length > 1);
          const partners = group?.filter((s) => s !== stage) ?? [];
          const title = t(`settingsPage.lineup.stages.${stage}`, STAGE_TITLES[stage]);
          return (
            // A card per stage (the mock's): its name and state on one line, the choice under them; the stages one
            // provider serves over one connection are outlined together.
            <div className={`lineup-stage${partners.length > 0 ? ' is-joint' : ''}`} key={stage}>
              <div className="lineup-stage__head">
                <span className="lineup-stage__name">{title}</span>
                <em className={`lineup-stage__state${stateOf(id).ok ? ' is-ready' : ''}`}>{stateOf(id).text}</em>
              </div>
              <select className="select-dropdown provider-select" value={id} disabled={locked} aria-label={title}
                onChange={(e) => void choose(stage, e.target.value)}>
                {rich && <button type="button"><selectedcontent /></button>}
                {optionsFor(stage).map((m) => <ProviderOption key={m.id} model={m} rich={rich} />)}
              </select>
              {partners.length > 0 && (
                <p className="lineup-stage__joint">
                  <Link2 size={12} aria-hidden="true" />
                  {t('settingsPage.lineup.joint', 'Goes with {{stages}} over one connection; they change together.', { stages: partners.map(stageName).join(t('settingsPage.lineup.and', ' and ')) })}
                </p>
              )}
              {stage === 'transcription' && graniteDirect && (
                <p className="lineup-stage__joint">
                  <Link2 size={12} aria-hidden="true" />
                  {t('settingsPage.lineup.granite', 'With translation: Granite Speech turns speech straight into the translation.')}
                </p>
              )}
              {moved?.stage === stage && <p className="lineup-stage__moved" role="status">{moved.text}</p>}
            </div>
          );
        })}
      </div>
      {selectedProvider && (
        <div className="lineup-options" id="provider-options-section">
          <button type="button" className="lineup-options__fold" aria-expanded={!folded} onClick={() => setFolded((f) => !f)}>
            {folded ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            {t('settingsPage.lineup.options', '{{provider}} options', { provider: model(selectedProvider.id, selectedProvider).name })}
          </button>
          {!folded && (
            <>
              <ProviderEngine providers={providers} disabled={locked}
                initialSlot={engineSlotTarget} onInitialSlotConsumed={() => setEngineSlotTarget(null)} />
              <ProviderOwnSettings providers={providers} auth={auth} disabled={locked} />
              <ProviderTurnDetectionControls providers={providers} disabled={locked} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
