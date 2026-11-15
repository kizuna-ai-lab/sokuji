// src/components/SettingsPage/LineUpCategory.tsx
//
// "Languages and line-up": the language pair, the speech mode, and one row per
// stage choosing the provider that serves it (Plan 4's line-up). Which model or
// setting a provider uses is that provider's own options, folded under the rows.
// On the desktop a fourth card chooses who writes the notes: none, or OpenAI with
// the user's own key (client side only for now, owner 2026-11-16).
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AudioLines, ChevronDown, ChevronRight, Link2 } from 'lucide-react';
import { useAnalytics } from '../../lib/analytics';
import { caps } from '../../lib/lineup/catalog';
import { RUN_STAGES, type LineUp, type RunStage, type StageName } from '../../lib/lineup/types';
import { presentProviders } from '../../providers/registry';
import { lineUpChangedEvent, useLineUpStore } from '../../stores/lineUpStore';
import { useProviderStore } from '../../stores/providerStore';
import { useMode } from '../../stores/audioStore';
import { useEngineSlotTarget, useNavigateToSettings, useSetEngineSlotTarget, useSettingsNavigationTarget, useTextOnly } from '../../stores/settingsStore';
import { supportsBaseSelect } from '../../utils/supportsBaseSelect';
import { isElectron } from '../../utils/environment';
import { getManifestEntry } from '../../lib/local-inference/modelManifest';
import { directionKey, type Selections } from '../../lib/local-inference/selection/types';
import { ProviderLanguages } from '../providers/ProviderLanguages';
import { ProviderEngine, ProviderOwnSettings, ProviderTurnDetectionControls } from '../providers/ProviderOwnSettings';
import { ProviderOption, useOptionModel, type ProviderOptionModel } from '../providers/ProviderOption';
import { SettingsStage, cardOptions, useStageList } from '../providers/stageParts';
import { useAuthContext } from '../providers/useAuthContext';
import { SpeechSection } from '../Settings/sections/SpeechSection';
import { EdgeVoices } from './EdgeVoices';
import type { AnyProvider } from '../../lib/provider/types';
import type { CategoryBodyProps } from './SettingsPage';

const STAGE_TITLES: Record<RunStage, string> = { transcription: 'Transcription', translation: 'Translation', speech: 'Speech' };

/**
 * The navigation targets that live in a stage card's folded options (mock v19): the card each one unfolds first.
 * 'first' is the first card that has options.
 */
const TARGET_CARD: Readonly<Record<string, RunStage | 'first'>> = {
  'provider-options': 'first', 'model-management': 'first',
  'model-asr': 'transcription', 'turn-detection-tuning': 'transcription',
  'model-translation': 'translation', 'system-instructions': 'translation',
  'model-tts': 'speech', 'voice-settings': 'speech', 'edge-voices': 'speech',
};
/** An engine slot's stage, as the line-up names it. */
const SLOT_CARD: Readonly<Record<string, RunStage>> = { asr: 'transcription', translation: 'translation', tts: 'speech' };

import { stageInSentence } from '../../lib/lineup/stageWords';
export { stageInSentence };

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
  // Which stage cards have their provider's options open (mock v19: each card its own).
  const [openCards, setOpenCards] = useState<Partial<Record<RunStage, boolean>>>({});
  // A slot a notice asked for (a voice to fix, #619): the engine opens it, then it is spent.
  const engineSlotTarget = useEngineSlotTarget();
  const setEngineSlotTarget = useSetEngineSlotTarget();
  const [moved, setMoved] = useState<{ stage: StageName; text: string } | null>(null);

  // Every provider with a key is loaded, so that its row can say whether the key is there.
  useEffect(() => {
    for (const p of providers) if (p.kind === 'own-key' && !useProviderStore.getState().entries[p.id]) void useProviderStore.getState().load(p);
  }, [providers]);


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

  // The notes card: OpenAI is offered once it has a key (or while it is chosen, to show what it lacks).
  const notesService = lineUp?.summarisation ?? null;
  const openAi = providers.find((p) => p.id === 'openai');
  const openAiKeyed = Boolean(openAi) && credentialsMissing(openAi, auth.signedIn) === null;
  const notesState = notesService === null
    ? { ok: false, text: t('settingsPage.lineup.state.off', 'Off') }
    : openAiKeyed ? { ok: true, text: t('settingsPage.lineup.state.ready', 'Ready') } : { ok: false, text: t('settingsPage.lineup.state.needsKey', 'Needs a key') };
  const chooseNotes = async (id: string) => {
    const before: LineUp | null = useLineUpStore.getState().lineUp;
    const choice = await useLineUpStore.getState().choose('summarisation', id || null);
    if (choice && before) trackEvent('lineup_changed', lineUpChangedEvent('summarisation', before, choice));
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

  // Each card's options (mock v19): the provider family serving the card's stage (Bing and Edge belong to this
  // device's), and the stages that family serves; Bing has no options.
  const familyOf = (id: string) => caps(id)?.family ?? id;
  const ownerOf = (stage: RunStage): string | null => {
    const id = lineUp?.[stage];
    return !id || id === 'bing' ? null : familyOf(id);
  };
  const servedBy = (owner: string) => RUN_STAGES.filter((s) => ownerOf(s) === owner);
  const optionsOf = (stage: RunStage) => {
    const owner = ownerOf(stage);
    const provider = owner ? providers.find((p) => p.id === owner) : undefined;
    if (!owner || !provider) return null;
    const served = servedBy(owner);
    return { owner, provider, served, ...cardOptions(provider.optionStages, served, stage, Boolean(provider.TurnDetection)) };
  };
  const firstWithOptions = RUN_STAGES.find((s) => optionsOf(s)?.has);
  const openCard = (stage: RunStage | undefined) => { if (stage) setOpenCards((o) => (o[stage] ? o : { ...o, [stage]: true })); };

  // A target inside a card's options unfolds that card before the page scrolls to it; so does an engine slot asked for.
  useEffect(() => {
    const card = target ? TARGET_CARD[target] : undefined;
    if (card) openCard(card === 'first' ? firstWithOptions : card);
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (engineSlotTarget) openCard(SLOT_CARD[engineSlotTarget.stage]);
  }, [engineSlotTarget]); // eslint-disable-line react-hooks/exhaustive-deps
  const stageList = useStageList();

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
              {stage === 'transcription' && isElectron() && lineUp?.transcription === 'soniox' && (
                <p className="lineup-stage__joint">
                  <AudioLines size={12} aria-hidden="true" />
                  {t('settingsPage.lineup.alsoFiles', 'Also transcribes imported files and records again.')}
                </p>
              )}
              {moved?.stage === stage && <p className="lineup-stage__moved" role="status">{moved.text}</p>}
              {(() => {
                const o = optionsOf(stage);
                if (!o?.has) return null;
                const open = Boolean(openCards[stage]);
                const name = model(id, providers.find((p) => p.id === id)).name;
                return (
                  <div className="lineup-stage__options" id={stage === firstWithOptions ? 'provider-options-section' : `lineup-options-${stage}`}>
                    <button type="button" className="lineup-options__fold" aria-expanded={open} onClick={() => setOpenCards((c) => ({ ...c, [stage]: !open }))}>
                      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      {t('settingsPage.lineup.options', '{{provider}} options', { provider: name })}
                    </button>
                    {open && (
                      <div className="lineup-stage__options-body">
                        {o.provider.optionStages ? (
                          <SettingsStage stage={stage} served={o.served}>
                            {/* Edge speaking: its voices, not the engine's speech slot, whose models do not run. */}
                            {stage === 'speech' && id === 'edge' ? <EdgeVoices disabled={locked} /> : (
                              <ProviderEngine providers={providers} providerId={o.owner} disabled={locked}
                                initialSlot={engineSlotTarget && SLOT_CARD[engineSlotTarget.stage] === stage ? engineSlotTarget : null}
                                onInitialSlotConsumed={() => setEngineSlotTarget(null)} />
                            )}
                            <ProviderOwnSettings providers={providers} providerId={o.owner} auth={auth} disabled={locked} />
                            {stage === 'transcription' && <ProviderTurnDetectionControls providers={providers} providerId={o.owner} disabled={locked} />}
                          </SettingsStage>
                        ) : (
                          <>
                            <ProviderEngine providers={providers} providerId={o.owner} disabled={locked}
                              initialSlot={engineSlotTarget} onInitialSlotConsumed={() => setEngineSlotTarget(null)} />
                            <ProviderOwnSettings providers={providers} providerId={o.owner} auth={auth} disabled={locked} />
                            <ProviderTurnDetectionControls providers={providers} providerId={o.owner} disabled={locked} />
                          </>
                        )}
                        {o.pointerTo && (
                          <p className="lineup-stage__pointer">
                            {t('settingsPage.lineup.pointer', 'The options acting on {{stages}} are in the “{{card}}” card.', {
                              stages: stageList(o.pointerStages), card: t(`settingsPage.lineup.stages.${o.pointerTo}`, STAGE_TITLES[o.pointerTo]),
                            })}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })}
        {isElectron() && (
          <div className="lineup-stage">
            <div className="lineup-stage__head">
              <span className="lineup-stage__name">{t('settingsPage.lineup.stages.summarisation', 'Notes')}</span>
              <em className={`lineup-stage__state${notesState.ok ? ' is-ready' : ''}`}>{notesState.text}</em>
            </div>
            <select className="select-dropdown" value={notesService ?? ''} disabled={locked} aria-label={t('settingsPage.lineup.stages.summarisation', 'Notes')}
              onChange={(e) => void chooseNotes(e.target.value)}>
              <option value="">{t('settingsPage.lineup.notesNone', 'None')}</option>
              {(openAiKeyed || notesService === 'openai') && <option value="openai">OpenAI</option>}
            </select>
            {!openAiKeyed && <p className="lineup-stage__joint">{t('settingsPage.lineup.notesNeedKey', 'Add an OpenAI key in Accounts and keys to have notes written.')}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
