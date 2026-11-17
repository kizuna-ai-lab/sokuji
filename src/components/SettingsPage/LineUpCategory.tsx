// src/components/SettingsPage/LineUpCategory.tsx
//
// "Languages and line-up": the language pair, the speech mode, and one row per
// stage choosing the provider that serves it (Plan 4's line-up). Which model or
// setting a provider uses is that provider's own options, folded under the rows.
// On the desktop a fourth card chooses who writes the notes: none, Kizuna AI
// (signed in, paid from the balance, through our relay), or OpenAI with the
// user's own key.
import { useWordList } from '../../lib/words/list';
import { modelTakesWords, wordServiceOf, wordsFor } from '../../lib/words/forService';
import { effectiveGeminiModel } from '../../providers/gemini/settings';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AudioLines, ChevronDown, ChevronRight, Link2, ListX } from 'lucide-react';
import { useAnalytics } from '../../lib/analytics';
import { caps } from '../../lib/lineup/catalog';
import { KIZUNA_NOTES, notesServiceOf } from '../../lib/notes/notesService';
import { perHour, useNotesPricing } from '../../lib/notes/notesPricing';
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
import { KizunaAIIcon } from '../Icons/ProviderIcons';
import { SettingsStage, cardOptions, useStageList } from '../providers/stageParts';
import { useAuthContext } from '../providers/useAuthContext';
import { SpeechSection } from '../Settings/sections/SpeechSection';
import { EdgeVoices } from './EdgeVoices';
import { asSonioxRegion, SONIOX_REGION_LABELS } from '../../lib/soniox/regions';
import { LocalVoices } from './LocalVoices';
import { providerTarget } from './accountRows';
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
  'model-tts': 'speech', 'voice-settings': 'speech', 'edge-voices': 'speech', 'local-voices': 'speech',
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
  const wordEntries = useWordList((s) => s.entries);
  const wordBackground = useWordList((s) => s.background);
  // The Gemini model a session would run: the list goes to some models only.
  const geminiModel = useProviderStore((s) => {
    const settings = s.entries.gemini?.settings as { model?: string } | undefined;
    return settings ? effectiveGeminiModel({ model: settings.model ?? '' }, s.models.gemini ?? []) : null;
  });
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

  // The notes card: Kizuna AI wherever the hosted services are, usable signed in; OpenAI once it has a key. Either
  // stays listed while it is chosen, to show what it lacks. It always names one (owner, 2026-11-17: no "None"): with
  // none stored, the default; whether notes are written is the switches' call in History and notes.
  const openAi = providers.find((p) => p.id === 'openai');
  const openAiKeyed = Boolean(openAi) && credentialsMissing(openAi, auth.signedIn) === null;
  const kizunaOffered = isElectron() && providers.some((p) => p.kind === 'managed');
  const notesService = notesServiceOf(lineUp, { hostedOffered: kizunaOffered, signedIn: auth.signedIn, openAiKeyed });
  const kizunaChosen = notesService === KIZUNA_NOTES;
  // The app checks only the session's own provider by itself: OpenAI chosen for the notes alone was never checked, and
  // its card said "Key not verified" for ever (the owner, 2026-11-17). The card checks the key it shows, once, while
  // nothing has checked it yet; not during a session.
  const openAiNotesUnchecked = notesService === 'openai' && openAiKeyed && Boolean(entries.openai)
    && (readiness.openai?.state ?? 'unknown') === 'unknown';
  useEffect(() => {
    if (!openAiNotesUnchecked || locked || !openAi) return;
    void useProviderStore.getState().refreshReadiness(openAi, auth);
  }, [openAiNotesUnchecked, locked]); // eslint-disable-line react-hooks/exhaustive-deps
  const notesPricing = useNotesPricing(kizunaOffered);
  const kizunaBlocked = kizunaOffered && !auth.signedIn && !kizunaChosen;
  // The notes' choices, as the other stages draw theirs; their lines say how each writes the notes.
  const notesOptions: ProviderOptionModel[] = [
    ...(kizunaOffered || kizunaChosen ? [{
      id: KIZUNA_NOTES, name: 'Kizuna AI', icon: KizunaAIIcon,
      description: t('settingsPage.lineup.notesKizunaLine', 'OpenAI writes the notes through Kizuna AI, paid from your balance.'),
      ...(kizunaBlocked ? { blocked: t('settingsPage.lineup.needsSignIn', 'needs a sign-in') } : {}),
    }] : []),
    ...(openAiKeyed || notesService === 'openai' ? [{
      id: 'openai', name: 'OpenAI', icon: openAi?.icon,
      description: t('settingsPage.lineup.notesOpenAiLine', 'Writes the notes with your own OpenAI key.'),
    }] : []),
  ];
  const chooseNotes = async (id: string) => {
    const before: LineUp | null = useLineUpStore.getState().lineUp;
    const choice = await useLineUpStore.getState().choose('summarisation', id);
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
      text: t('settingsPage.lineup.moved', '{{stages}} moved to {{providers}} too: they cannot be combined with this choice yet. Mixing will be supported later.', {
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

  /**
   * One stage's options: the rows acting on it alone, and those acting on several stages when it is the first of them
   * (owner, 2026-11-17: in a card of several stages each keeps its own). A stage whose options all sit under an earlier
   * stage of the same card has no fold; one whose options sit in another card points there.
   */
  const stageOptions = (stage: RunStage, id: string, cardStages: readonly RunStage[]) => {
    const o = optionsOf(stage);
    if (!o) return null;
    const pointerTo = o.pointerTo && !cardStages.includes(o.pointerTo) ? o.pointerTo : null;
    if (!o.rows && !pointerTo) return null;
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
                  <>
                    <ProviderEngine providers={providers} providerId={o.owner} disabled={locked}
                      initialSlot={engineSlotTarget && SLOT_CARD[engineSlotTarget.stage] === stage ? engineSlotTarget : null}
                      onInitialSlotConsumed={() => setEngineSlotTarget(null)} />
                    {/* This device speaking: its voices under its speech model (B-20, out of the old model library). */}
                    {stage === 'speech' && id === 'local_inference' && <LocalVoices disabled={locked} />}
                  </>
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
            {pointerTo && (
              <p className="lineup-stage__pointer">
                {t('settingsPage.lineup.pointer', 'The options acting on {{stages}} are in the “{{card}}” card.', {
                  stages: stageList(o.pointerStages), card: t(`settingsPage.lineup.stages.${pointerTo}`, STAGE_TITLES[pointerTo]),
                })}
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  /** The line-up's cards: one per stage, but the stages one provider binds, next to each other, in one (owner, 2026-11-17). */
  const cards: RunStage[][] = [];
  for (let i = 0; i < RUN_STAGES.length; ) {
    const stage = RUN_STAGES[i];
    const id = lineUp?.[stage] ?? '';
    const group = caps(id)?.binds.find((g) => g.includes(stage) && g.length > 1);
    let j = i + 1;
    while (group && j < RUN_STAGES.length && group.includes(RUN_STAGES[j]) && (lineUp?.[RUN_STAGES[j]] ?? '') === id) j += 1;
    cards.push(RUN_STAGES.slice(i, j) as RunStage[]);
    i = j;
  }

  /** A row's state: what the chosen provider lacks, or Ready; a key it lacks or that does not work, or a sign-in it waits for, takes you to
   *  that provider's row in Accounts and keys. */
  const stateOf = (id: string): { ok: boolean; text: string; toAccount?: boolean } => {
    const p = providers.find((x) => x.id === id) ?? (caps(id)?.family === 'local_inference' ? providers.find((x) => x.id === 'local_inference') : undefined);
    // Bing and Edge are online services of the local family: no key and no model.
    if (id === 'bing' || id === 'edge') return { ok: true, text: t('settingsPage.lineup.state.ready', 'Ready') };
    const missing = credentialsMissing(p, auth.signedIn);
    if (missing === 'key') return { ok: false, text: t('settingsPage.lineup.state.needsKey', 'Needs a key'), toAccount: true };
    if (missing === 'sign-in') return { ok: false, text: t('settingsPage.lineup.state.needsSignIn', 'Needs a sign-in'), toAccount: true };
    const r = p ? readiness[p.id] : undefined;
    if (p?.kind === 'local' && r?.state === 'not-ready') return { ok: false, text: t('settingsPage.lineup.state.needsModel', 'Needs a model') };
    // A saved key is Ready only once its check passed (B-11; Rudolf's review: saved is not working). The store keeps a
    // passed check for the same key and region, so a key that worked before stays Ready when the service is out of reach.
    if (p?.kind === 'own-key') {
      if (r?.state === 'ready') return { ok: true, text: t('settingsPage.lineup.state.ready', 'Ready') };
      if (r?.state === 'checking') return { ok: false, text: t('settingsPage.lineup.state.checkingKey', 'Checking the key…') };
      // Refused: a Soniox key works in one region's project only, so it names the region it was tried in.
      if (r?.state === 'not-ready' && r.code === 'auth') {
        const region = p.id === 'soniox' ? SONIOX_REGION_LABELS[asSonioxRegion((entries[p.id]?.settings as { region?: string } | undefined)?.region)] : null;
        return {
          ok: false, toAccount: true,
          text: region ? t('settingsPage.lineup.state.noKeyForRegion', 'No working key for {{region}}', { region })
            : t('settingsPage.lineup.state.keyRefused', 'Key not accepted'),
        };
      }
      // Never checked, or the check could not reach the service.
      return { ok: false, toAccount: true, text: t('settingsPage.lineup.state.keyNotVerified', 'Key not verified') };
    }
    return { ok: true, text: t('settingsPage.lineup.state.ready', 'Ready') };
  };
  /** A row's state as drawn: a key it lacks or that does not work, or a sign-in it waits for, is a way to its account row. */
  const stateTag = (id: string) => {
    const s = stateOf(id);
    const className = `lineup-stage__state${s.ok ? ' is-ready' : ''}`;
    return s.toAccount
      ? <button type="button" className={`${className} lineup-stage__state--link`} onClick={() => navigateToSettings(providerTarget(id))}>{s.text}</button>
      : <em className={className}>{s.text}</em>;
  };

  // The notes card's state: Kizuna AI's from the sign-in; OpenAI's is the OpenAI stage's own (stateTag), so a key that
  // is missing, rejected or not yet checked reads the same here as on a stage, and takes you to the key (review).
  const kizunaNotesState = auth.signedIn
    ? { ok: true, text: t('settingsPage.lineup.state.ready', 'Ready') }
    : { ok: false, text: t('settingsPage.lineup.state.needsSignIn', 'Needs a sign-in') };

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
        {cards.map((stages) => {
          const first = stages[0];
          const id = lineUp?.[first] ?? '';
          const group = caps(id)?.binds.find((g) => g.includes(first) && g.length > 1);
          // Partners the card does not hold (bound, but not next to it): named under the choice, as before.
          const partners = group?.filter((s) => !stages.includes(s as RunStage)) ?? [];
          const joint = stages.length > 1;
          const titleOf = (stage: RunStage) => t(`settingsPage.lineup.stages.${stage}`, STAGE_TITLES[stage]);
          const title = joint ? [titleOf(first), ...stages.slice(1).map(stageName)].join(t('settingsPage.lineup.and', ' and ')) : titleOf(first);
          const head = (stage: RunStage) => (
            <div className="lineup-stage__head">
              <span className="lineup-stage__name">{titleOf(stage)}</span>
              {stateTag(id)}
            </div>
          );
          // What one stage of the card says about itself, then its own options.
          const stageBody = (stage: RunStage) => (
            <>
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
              {(() => {
                // The word list goes to the services that hear and translate: over a service's limit, its first stage says so.
                if (stage !== 'transcription' && stage !== 'translation') return null;
                const id = lineUp?.[stage] ?? null;
                if (stage === 'translation' && id === lineUp?.transcription) return null;
                const service = wordServiceOf(id);
                if (!service) return null;
                // A model that takes no word list: said, not left silent (the list is not sent to it).
                if (service === 'gemini' && wordEntries.length > 0 && !modelTakesWords('gemini', geminiModel)) {
                  return (
                    <p className="lineup-stage__joint">
                      <ListX size={12} aria-hidden="true" />
                      {t('settingsPage.lineup.wordsUnused', 'Word list: this model cannot use it.')}
                    </p>
                  );
                }
                const leftOut = wordsFor(service, wordEntries, wordBackground).leftOut;
                if (leftOut === 0) return null;
                return (
                  <p className="lineup-stage__joint">
                    <ListX size={12} aria-hidden="true" />
                    {t('settingsPage.lineup.wordsLeftOut', 'Word list: {{count}} entries over this service’s limit are left out.', { count: leftOut })}
                  </p>
                );
              })()}
              {moved?.stage === stage && <p className="lineup-stage__moved" role="status">{moved.text}</p>}
              {stageOptions(stage, id, stages)}
            </>
          );
          const select = (
            <select className="select-dropdown provider-select" value={id} disabled={locked} aria-label={title}
              onChange={(e) => void choose(first, e.target.value)}>
              {rich && <button type="button"><selectedcontent /></button>}
              {optionsFor(first).map((m) => <ProviderOption key={m.id} model={m} rich={rich} />)}
            </select>
          );
          const partnersLine = partners.length > 0 && (
            <p className="lineup-stage__joint">
              <Link2 size={12} aria-hidden="true" />
              {t('settingsPage.lineup.joint', 'Goes with {{stages}} over one connection; they change together.', { stages: partners.map(stageName).join(t('settingsPage.lineup.and', ' and ')) })}
            </p>
          );
          return (
            // A card per stage (the mock's): its name and state on one line, the choice under them. The stages one
            // provider binds over one connection share one card (owner, 2026-11-17): the line saying so and the one
            // choice on top, then a part per stage, each with its name and state and its own options under them (the
            // options are not merged). Stages that merely use the same provider keep their own cards.
            <div className={`lineup-stage${joint || partners.length > 0 ? ' is-joint' : ''}`} key={stages.join('+')}>
              {joint ? (
                <>
                  <p className="lineup-stage__joint">
                    <Link2 size={12} aria-hidden="true" />
                    {t('settingsPage.lineup.jointCard', '{{stages}} go over one connection; they change together.', { stages: title })}
                  </p>
                  {select}
                  {partnersLine}
                  {stages.map((stage) => (
                    <div className="lineup-stage__part" key={stage}>
                      {head(stage)}
                      {stageBody(stage)}
                    </div>
                  ))}
                </>
              ) : (
                <>
                  {head(first)}
                  {select}
                  {partnersLine}
                  {stageBody(first)}
                </>
              )}
            </div>
          );
        })}
        {isElectron() && (
          <div className="lineup-stage">
            <div className="lineup-stage__head">
              <span className="lineup-stage__name">{t('settingsPage.lineup.stages.summarisation', 'Notes')}</span>
              {kizunaChosen
                ? kizunaNotesState.ok
                  ? <em className="lineup-stage__state is-ready">{kizunaNotesState.text}</em>
                  : <button type="button" className="lineup-stage__state lineup-stage__state--link" onClick={() => navigateToSettings('user-account')}>{kizunaNotesState.text}</button>
                : stateTag('openai')}
            </div>
            {/* Drawn like the other stages' choices (owner, 2026-11-17): an icon, the name, a line about writing notes. */}
            <select className="select-dropdown provider-select" value={notesService} disabled={locked} aria-label={t('settingsPage.lineup.stages.summarisation', 'Notes')}
              onChange={(e) => void chooseNotes(e.target.value)}>
              {rich && <button type="button"><selectedcontent /></button>}
              {notesOptions.map((m) => <ProviderOption key={m.id} model={m} rich={rich} />)}
            </select>
            {/* Kizuna AI's prices where Kizuna AI writes the notes, not under OpenAI's own key (the owner, 2026-11-17). */}
            {kizunaChosen && auth.signedIn && notesPricing && (
              <p className="lineup-stage__joint">{t('settingsPage.lineup.notesKizunaPrice', 'Kizuna AI estimates: live notes about {{live}} an hour, notes after a session about {{after}} an hour, paid from the balance that pays for your sessions.', { live: perHour(notesPricing.liveUsdPerHour), after: perHour(notesPricing.afterSessionUsdPerHour) })}</p>
            )}
            {!openAiKeyed && !kizunaOffered && <p className="lineup-stage__joint">{t('settingsPage.lineup.notesNeedKey', 'Add an OpenAI key in Accounts and keys to have notes written.')}</p>}
            {/* Signed out where Kizuna AI writes the notes: chosen on purpose, adding a key does not change the choice, so
                the line says to choose OpenAI here too (review); by default, a key is enough. */}
            {kizunaOffered && !auth.signedIn && (lineUp?.summarisation === KIZUNA_NOTES
              ? <p className="lineup-stage__joint">{openAiKeyed
                ? t('settingsPage.lineup.notesNeedSignInOrChoose', 'Sign in, or choose OpenAI here, to have notes written.')
                : t('settingsPage.lineup.notesNeedSignInOrKeyAndChoose', 'Sign in, or add an OpenAI key in Accounts and keys and choose OpenAI here, to have notes written.')}</p>
              : !openAiKeyed && <p className="lineup-stage__joint">{t('settingsPage.lineup.notesNeedSignInOrKey', 'Sign in, or add an OpenAI key in Accounts and keys, to have notes written.')}</p>)}
          </div>
        )}
      </div>
    </div>
  );
}
