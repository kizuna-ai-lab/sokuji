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
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AudioLines, ChevronDown, ChevronRight, Link2, ListX } from 'lucide-react';
import { useAnalytics } from '../../lib/analytics';
import { caps, carriedTogether, goesWith } from '../../lib/lineup/catalog';
import { refusalNotice } from '../../lib/plan/checks';
import { choiceInput, refusedChoice } from '../../lib/plan/choice';
import { usePlan } from '../../lib/plan/fromStores';
import type { PlanRefusalCode } from '../../lib/plan/types';
import { useLineUpNotice } from '../../lib/session/useLineUpNotice';
import { noticeText } from '../../lib/view/noticeText';
import { KIZUNA_NOTES, notesServiceOf } from '../../lib/notes/notesService';
import { perHour, useNotesPricing } from '../../lib/notes/notesPricing';
import { RUN_STAGES, type LineUp, type RunStage, type StageName } from '../../lib/lineup/types';
import { presentProviders } from '../../providers/registry';
import { lineUpChangedEvent, useLineUpStore } from '../../stores/lineUpStore';
import { useProviderStore } from '../../stores/providerStore';
import { useMode } from '../../stores/audioStore';
import { useEngineSlotTarget, useNavigateToSettings, useSetEngineSlotTarget, useSetTextOnly, useSettingsNavigationTarget, useTextOnly } from '../../stores/settingsStore';
import { supportsBaseSelect } from '../../utils/supportsBaseSelect';
import { isElectron } from '../../utils/environment';
import { getManifestEntry } from '../../lib/local-inference/modelManifest';
import { directionKey, type Selections } from '../../lib/local-inference/selection/types';
import { ProviderLanguages } from '../providers/ProviderLanguages';
import type { ReceiveChoice } from '../providers/LanguagePairSection';
import { useHearingRows } from '../MainPanel/useHearingRows';
import { AudioModeSwitch } from './AudioModeSwitch';
import { ProviderEngine, ProviderOwnSettings, ProviderTurnDetectionControls } from '../providers/ProviderOwnSettings';
import { ProviderOption, optionText, useOptionModel, type ProviderOptionModel } from '../providers/ProviderOption';
import { KizunaOpenAIIcon } from '../Icons/ProviderIcons';
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

/** The refusals that say the chosen services do not go together. */
const CANNOT_COMBINE: ReadonlySet<string> = new Set(['lineup_voice_not_alone', 'lineup_voice_not_taken', 'lineup_stage_split', 'lineup_translation_bound', 'lineup_no_unit', 'lineup_two_managed', 'lineup_face_to_face_apart']);

import { stageInSentence } from '../../lib/lineup/stageWords';
import { isTextModelProvider } from '../../lib/textModel/ids';
export { stageInSentence };

/**
 * The stages one connection of `id` carries together with `stage` when the line-up gives it all of them, when that
 * is more than `stage` alone: an end-to-end provider's three, or Soniox's transcription and translation.
 */
function carriedWith(id: string, stage: RunStage): readonly RunStage[] | undefined {
  const option = caps(id);
  const group = option && carriedTogether(option);
  return group && group.length > 1 && group.includes(stage) ? group : undefined;
}

/**
 * Whether a provider's key or sign-in is in place, as far as this page can tell without a check. A field that may
 * be left empty (a compatible service's key) is not missing; a compatible service's address is said as such.
 */
function credentialsMissing(p: AnyProvider | undefined, signedIn: boolean): 'key' | 'sign-in' | 'address' | null {
  if (!p) return null;
  if (p.kind === 'managed') return signedIn ? null : 'sign-in';
  if (p.kind !== 'own-key') return null;
  const entry = useProviderStore.getState().entries[p.id];
  if (!entry) return 'key';
  const fields = p.credentials.fields(entry.settings as never);
  const missing = fields.find((f) => !f.optional && String(entry.credentials[f.key] ?? '').trim() === '');
  if (!missing) return null;
  return missing.key === 'baseUrl' ? 'address' : 'key';
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
  // Who hears and who reads (owner, 2026-11-18, design 1): the sentence's words are the audio page's two switches, by
  // the same rules (useHearingRows); the speech stage is used only while a running leg is read aloud.
  const hearing = useHearingRows(locked);
  // The sentence shows once the plan is ready, its providers' entries loaded (ProviderLanguages); until then nothing points to it.
  const plan = usePlan();
  const sentenceShown = plan.state === 'ready';
  const setTextOnly = useSetTextOnly();
  // A line-up that cannot run is never silent: the composer's refusal of it, or what its plan cannot do for the
  // pair and the legs a start would open, in the start gate's words. The hook follows everything it is read from:
  // the plan, a provider's pair, the mode and who hears.
  const refusal = useLineUpNotice();
  const model = useOptionModel();
  const [rich] = useState(() => supportsBaseSelect());
  // Which stage cards have their provider's options open (mock v19: each card its own).
  const [openCards, setOpenCards] = useState<Partial<Record<RunStage, boolean>>>({});
  // A slot a notice asked for (a voice to fix, #619): the engine opens it, then it is spent.
  const engineSlotTarget = useEngineSlotTarget();
  const setEngineSlotTarget = useSetEngineSlotTarget();
  // Speech followed the last choice (its voice could not stay beside the chosen text side): said on the speech
  // card while the line-up is the one that choice made, and until the next choice.
  const [followedBy, setFollowedBy] = useState<{ text: string; lineUp: LineUp } | null>(null);
  const followed = followedBy && lineUp && RUN_STAGES.every((s) => lineUp[s] === followedBy.lineUp[s]) ? followedBy.text : null;
  // Once the line-up is another one, the line is spent: it is not said again should the line-up come back.
  useEffect(() => {
    if (followedBy && !followed) setFollowedBy(null);
  }, [followedBy, followed]);
  // Counts the choices made on this page, the notes' included: a choice whose save completes after a later one was
  // made says nothing, the line having been taken away by that later choice.
  const choiceCount = useRef(0);

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

  // What the composer is asked with for a choice not made yet: what the store asks it with when the choice is made.
  const composing = choiceInput(providers, entries);

  /** Why an option cannot be combined with the other stages, short enough to stand after its name. */
  const shortReason = (code: PlanRefusalCode): string | undefined => {
    if (code === 'lineup_voice_not_alone') return t('settingsPage.lineup.voiceNotAlone', 'reads only its own translation');
    if (code === 'lineup_voice_not_taken') return t('settingsPage.lineup.voiceNotTaken', 'uses only its own voice');
    if (code === 'lineup_two_managed') return t('settingsPage.lineup.twoManaged', 'one Kizuna AI service at a time');
    return undefined;
  };

  const optionsFor = (stage: RunStage): ProviderOptionModel[] => {
    return providers.flatMap((p) => (p.id === 'local_inference' ? [p.id, 'bing', 'edge'] : [p.id]))
      .filter((id) => offered.has(id) && caps(id)?.stages.includes(stage))
      .map((id) => {
        const p = providers.find((x) => x.id === id);
        const m = model(id, p);
        // The current choice is never held back: it is shown, and can be left.
        if (lineUp?.[stage] === id) return m;
        const missing = credentialsMissing(p, auth.signedIn);
        // A compatible service with no address yet stays a choice: its address is entered after it is chosen, and its
        // card leads to where.
        if (missing && missing !== 'address') {
          m.blocked = missing === 'key' ? t('settingsPage.lineup.needsKey', 'needs a key') : t('settingsPage.lineup.needsSignIn', 'needs a sign-in');
          return m;
        }
        // A choice that would leave a line-up the composer refuses, the other stages as they are: said before it
        // is made, in a few words; the whole sentence is the card's, once such a line-up is stored.
        const refused = lineUp ? refusedChoice(lineUp, stage, id, composing) : null;
        if (refused) m.blocked = shortReason(refused.refusal.refused) ?? noticeText(t, refusalNotice(refused.refusal, refused.lineUp, providers));
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
      id: KIZUNA_NOTES, name: 'Kizuna AI', icon: KizunaOpenAIIcon,
      description: t('settingsPage.lineup.notesKizunaLine', 'OpenAI writes the notes through Kizuna AI, paid from your balance.'),
      ...(kizunaBlocked ? { blocked: t('settingsPage.lineup.needsSignIn', 'needs a sign-in') } : {}),
    }] : []),
    ...(openAiKeyed || notesService === 'openai' ? [{
      id: 'openai', name: 'OpenAI', icon: openAi?.icon,
      description: t('settingsPage.lineup.notesOpenAiLine', 'Writes the notes with your own OpenAI key.'),
    }] : []),
  ];
  const chooseNotes = async (id: string) => {
    choiceCount.current += 1;
    setFollowedBy(null);
    const before: LineUp | null = useLineUpStore.getState().lineUp;
    const choice = await useLineUpStore.getState().choose('summarisation', id);
    if (choice && before) trackEvent('lineup_changed', lineUpChangedEvent('summarisation', before, choice));
  };

  const choose = async (stage: RunStage, id: string) => {
    // What the last choice made speech do is not said of this one, whatever comes of it.
    const made = (choiceCount.current += 1);
    setFollowedBy(null);
    const before: LineUp | null = useLineUpStore.getState().lineUp;
    const choice = await useLineUpStore.getState().choose(stage, id);
    if (!choice || !before) return;
    trackEvent('lineup_changed', lineUpChangedEvent(stage, before, choice));
    // Named as an option's text names it: a hosted provider with its engine.
    const name = (option: string) => optionText(model(option, providers.find((p) => p.id === option)));
    if (choice.followed && made === choiceCount.current) {
      setFollowedBy({
        text: t('settingsPage.lineup.voiceFollowed', 'Speech switched to {{provider}}. The previous speech service only supports its own translations.', { provider: name(choice.followed.to) }),
        lineUp: choice.lineUp,
      });
    }
    // A one-shot target that opened this page is spent once something is chosen here.
    if (target) navigateToSettings(null);
  };

  // Each card's options (mock v19): the host serving the card's stage (Bing and Edge run on this device's
  // provider), and the stages that host serves; Bing has no options.
  const hostOf = (id: string) => caps(id)?.host ?? id;
  const ownerOf = (stage: RunStage): string | null => {
    const id = lineUp?.[stage];
    return !id || id === 'bing' ? null : hostOf(id);
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

  /**
   * The line-up's cards: one per stage, but the stages one provider carries over one connection, next to each
   * other, in one (owner, 2026-11-17). Soniox transcribing for another service's translation has a card of its own.
   */
  const cards: RunStage[][] = [];
  for (let i = 0; i < RUN_STAGES.length; ) {
    const stage = RUN_STAGES[i];
    const id = lineUp?.[stage] ?? '';
    const group = carriedWith(id, stage);
    let j = i + 1;
    while (group && j < RUN_STAGES.length && group.includes(RUN_STAGES[j]) && (lineUp?.[RUN_STAGES[j]] ?? '') === id) j += 1;
    cards.push(RUN_STAGES.slice(i, j) as RunStage[]);
    i = j;
  }

  /** A row's state: what the chosen provider lacks, or Ready; a key it lacks or that does not work, or a sign-in it waits for, takes you to
   *  that provider's row in Accounts and keys. */
  const stateOf = (id: string): { ok: boolean; text: string; toAccount?: boolean } => {
    const p = providers.find((x) => x.id === id) ?? (caps(id)?.host === 'local_inference' ? providers.find((x) => x.id === 'local_inference') : undefined);
    // Bing and Edge are online services the local provider runs: no key and no model.
    if (id === 'bing' || id === 'edge') return { ok: true, text: t('settingsPage.lineup.state.ready', 'Ready') };
    const missing = credentialsMissing(p, auth.signedIn);
    if (missing === 'key') return { ok: false, text: t('settingsPage.lineup.state.needsKey', 'Needs a key'), toAccount: true };
    if (missing === 'address') return { ok: false, text: t('settingsPage.lineup.state.needsAddress', 'Needs an address'), toAccount: true };
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
      // A text model's check said what else is wrong (the model, the reasoning, the service): its words are on the
      // card (`checkWords`); an address that cannot be used is fixed where it is entered.
      if (r?.state === 'not-ready' && isTextModelProvider(p.id) && r.code !== undefined) {
        return { ok: false, text: t('settingsPage.lineup.state.notReady', 'Not ready'), ...(r.code.startsWith('address_') ? { toAccount: true } : {}) };
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

  /**
   * A stage's state while the line-up is refused on that stage: why, in a few words, in place of its provider's
   * readiness (the line-up has to change before a key or a sign-in matters). Plain text: nothing in Accounts and
   * keys answers it. Undefined for a stage with no service, which keeps the state it has.
   */
  const refusalTag = (code: string | undefined) => {
    const language = code === 'lineup_language_not_spoken' || code === 'lineup_pair_not_translated' || code === 'lineup_source_not_fixed';
    const text = language ? t('settingsPage.lineup.state.languageNotSpoken', 'Unsupported language')
      : code === 'lineup_not_offered' ? t('settingsPage.lineup.state.notAvailable', 'Not available here')
      : code && CANNOT_COMBINE.has(code) ? t('settingsPage.lineup.state.cannotCombine', "Can't be combined")
      : undefined;
    return text === undefined ? undefined : <em className="lineup-stage__state">{text}</em>;
  };

  /**
   * What a text model's check found wrong, in its words, on the card of the stage it serves (the model the service
   * does not offer, a reasoning value it refuses), while the line-up itself is not refused there.
   */
  const checkWords = (stage: RunStage) => {
    const id = lineUp?.[stage];
    if (!isTextModelProvider(id) || refusal?.stage === stage) return null;
    const r = readiness[id!];
    if (r?.state !== 'not-ready' || r.code === undefined || r.code === 'auth' || credentialsMissing(providers.find((p) => p.id === id), auth.signedIn)) return null;
    return <p className="lineup-stage__refusal" role="status">{noticeText(t, { code: r.code, message: r.reason, ...(r.params ? { params: r.params } : {}) })}</p>;
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

  // Why a hear-or-read word cannot be changed now: the Audio page's reasons, by useHearingRows' rules.
  const lockedByRun = () => t('audioPanel.rowLockedByRun', 'Fixed for this session; stop it to change.');
  const serviceRule = (): string | null => {
    if (hearing.speech === 'always') return t('audioPanel.otherHearsAlwaysSpeaks', 'This service always speaks.');
    if (hearing.speech === 'never') return t('audioPanel.otherHearsNeverSpeaks', 'This service never speaks.');
    return null;
  };
  const theirsBlocked = (): string | null => {
    if (locked) return lockedByRun();
    return serviceRule();
  };
  const mineBlocked = (): string | null => {
    if (hearing.themLocked) return lockedByRun();
    if (!hearing.participantOffered) return t('audioPanel.iHearNotOffered', "This service does not speak the other side's translation.");
    if (hearing.recaptured) return t('audioPanel.blockedWholeSystem', 'All system sound is being captured: these playback options are off, so the translation is not translated again.');
    return serviceRule();
  };
  const theirs: ReceiveChoice = {
    hears: hearing.otherOn,
    onChange: (hears) => { if (hears !== hearing.otherOn) setTextOnly(!hears); },
    blocked: theirsBlocked(),
  };
  const mine: ReceiveChoice = {
    hears: hearing.themOn,
    onChange: (hears) => { if (hears !== hearing.themOn) hearing.toggleThem(); },
    blocked: mineBlocked(),
  };
  const openAudio = (side: 'theirs' | 'mine') => navigateToSettings(side === 'mine' ? 'speech-i-hear' : 'speech-other-hears');
  // Speech is used this time when a running leg is read aloud; idle, its stage says why and, when a word above can
  // still be switched to hearing, how.
  const speechIdle = !((hearing.myLegRuns && hearing.otherOn) || (hearing.theirLegRuns && hearing.themOn));
  const canHear = sentenceShown && ((hearing.myLegRuns && !theirs.blocked) || (hearing.theirLegRuns && !mine.blocked));
  const speechUnusedNote = (
    <p className="lineup-stage__unused">
      <span>{t('settingsPage.lineup.speechNotUsed', 'Nothing is read aloud this time: the translation shows as text only.')}</span>
      {canHear && <span>{t('settingsPage.lineup.speechHowToHear', 'To have it read aloud, choose “hear” in the sentence above.')}</span>}
    </p>
  );

  return (
    <div className="lineup-category">
      <AudioModeSwitch locked={locked} />
      <ProviderLanguages
        providers={providers}
        disabled={locked}
        sentence={{ mode, textOnly }}
        heading={false}
        receive={{ theirs, mine, onOpenAudio: openAudio }}
      />
      <SpeechSection locked={locked} />
      <div className="config-section lineup-section" id="lineup-section">
        <h3 className="settings-subhead">
          <span>{t('settingsPage.lineup.title', 'Line-up')}</span>
          <small>{t('settingsPage.lineup.hint', 'Which service does each stage')}</small>
        </h3>
        {cards.map((stages) => {
          const first = stages[0];
          const id = lineUp?.[first] ?? '';
          const option = caps(id);
          // The stages this service serves with this one in this line-up and the card does not hold (not next to it):
          // named under the choice. A stage it must serve too and another service was given is not joined with this
          // one: the refusal says so on its card, and neither the line nor the frame of a joint card is drawn.
          const partners = option ? goesWith(option, first).filter((s) => !stages.includes(s) && lineUp?.[s] === id) : [];
          const joint = stages.length > 1;
          // One connection carries the card's stages, and yet they can be parted: Soniox's translation can be given
          // to another service, which its transcription then stands beside. The later stages get a choice of their own.
          const partable = joint && !option?.joint;
          const titleOf = (stage: RunStage) => t(`settingsPage.lineup.stages.${stage}`, STAGE_TITLES[stage]);
          const title = joint ? [titleOf(first), ...stages.slice(1).map(stageName)].join(t('settingsPage.lineup.and', ' and ')) : titleOf(first);
          // The speech stage, not used this time (nothing a running leg says is read aloud).
          const idle = (stage: RunStage) => stage === 'speech' && speechIdle;
          // Why the line-up cannot run a session now, on the card of the stage it is about.
          // On the speech card, first: that the voice changed with the last choice.
          const refusalLine = (stage: RunStage) => (
            <>
              {/* News, in the secondary text colour: the voice followed, nothing is wrong and nothing is a standing rule. */}
              {stage === 'speech' && followed && <p className="lineup-stage__joint lineup-stage__joint--news" role="status">{followed}</p>}
              {refusal?.stage === stage && <p className="lineup-stage__refusal" role="status">{noticeText(t, refusal)}</p>}
            </>
          );
          const head = (stage: RunStage) => (
            <div className="lineup-stage__head">
              <span className="lineup-stage__name">{titleOf(stage)}</span>
              {(refusal?.stage === stage ? refusalTag(refusal.code) : undefined) ?? (idle(stage)
                ? <em className="lineup-stage__state is-unused">{t('settingsPage.lineup.state.notUsed', 'Not used this time')}</em>
                : stateTag(id))}
            </div>
          );
          // Idle: why the line-up cannot run, and why speech is not used; no options (the choice stays for next time).
          const idleBody = (stage: RunStage) => (
            <>
              {refusalLine(stage)}
              {speechUnusedNote}
            </>
          );
          // What one stage of the card says about itself, then its own options. Speech not used this time: why, and
          // no options (the choice stays, for when something is read aloud again).
          const stageBody = (stage: RunStage) => (idle(stage) ? idleBody(stage) : (
            <>
              {stage === 'transcription' && graniteDirect && (
                <p className="lineup-stage__joint">
                  <Link2 size={12} aria-hidden="true" />
                  {t('settingsPage.lineup.granite', 'With translation: Granite Speech turns speech straight into the translation.')}
                </p>
              )}
              {/* Every recognition that also does files (Soniox with a key, and Kizuna AI's Soniox through the sign-in) says so. */}
              {stage === 'transcription' && isElectron() && providers.some((p) => p.id === lineUp?.transcription && p.fileRecognition) && (
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
              {refusalLine(stage)}
              {checkWords(stage)}
              {stageOptions(stage, id, stages)}
            </>
          ));
          const selectFor = (stage: RunStage, label: string) => (
            <select className="select-dropdown provider-select" value={lineUp?.[stage] ?? ''} disabled={locked} aria-label={label}
              onChange={(e) => void choose(stage, e.target.value)}>
              {rich && <button type="button"><selectedcontent /></button>}
              {optionsFor(stage).map((m) => <ProviderOption key={m.id} model={m} rich={rich} />)}
            </select>
          );
          const select = selectFor(first, title);
          const partnersLine = partners.length > 0 && (
            <p className="lineup-stage__joint">
              <Link2 size={12} aria-hidden="true" />
              {t('settingsPage.lineup.joint', 'Goes with {{stages}} over one connection; they change together.', { stages: partners.map(stageName).join(t('settingsPage.lineup.and', ' and ')) })}
            </p>
          );
          return (
            // A card per stage (the mock's): its name and state on one line, the choice under them. The stages one
            // provider carries over one connection share one card (owner, 2026-11-17): the line saying so and the one
            // choice on top, then a part per stage, each with its name and state and its own options under them (the
            // options are not merged). Stages that merely use the same provider keep their own cards.
            <div className={`lineup-stage${joint || partners.length > 0 ? ' is-joint' : ''}`} key={stages.join('+')}>
              {joint ? (
                <>
                  <p className="lineup-stage__joint">
                    <Link2 size={12} aria-hidden="true" />
                    {partable
                      ? t('settingsPage.lineup.partableCard', '{{stages}} go over one connection. Another service can do the translation: choose it below.', { stages: title })
                      : t('settingsPage.lineup.jointCard', '{{stages}} go over one connection; they change together.', { stages: title })}
                  </p>
                  {select}
                  {partnersLine}
                  {stages.map((stage) => (
                    <div className="lineup-stage__part" key={stage}>
                      {head(stage)}
                      {/* A stage that can be given to another service keeps a choice of its own in the shared card. */}
                      {partable && stage !== first && selectFor(stage, titleOf(stage))}
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
