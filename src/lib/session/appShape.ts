/**
 * The one place a runner reads the stores (plan 1c-1 Global Constraints):
 * `readShapeFromStores` freezes a shape at start, and `persistIfUnchanged`
 * writes a `prepare` patch back without overwriting a change the user made
 * during the run.
 */
import { useWordList } from '../words/list';
import type { Speak } from '../audio/outlets';
import type { LegName } from '../conversation/types';
import { stageIdsFor } from '../lineup/catalog';
import { participantSpeechHeard } from '../modern-audio/participantSource';
import { refusalNotice } from '../plan/checks';
import { planFromStores, subscribePlan } from '../plan/fromStores';
import { accountOf, capabilitiesOf, checkStagesOf, providersIn, servesSpeech, transcriptionAccount, transcriptionProvider } from '../plan/read';
import type { PlanRefusal } from '../plan/types';
import type { AuthContext, UnitCapabilities } from '../run/types';
import { reversedPair } from '../provider/languages';
import type { AnyProvider, Platform, Readiness } from '../provider/types';
import { accountPayer } from './payerChoice';
import { presentProviders } from '../../providers/registry';
import { useAccountStore } from '../../stores/accountStore';
import useAudioStore, { type AudioMode } from '../../stores/audioStore';
import { lineUpThatRuns } from '../../stores/lineUpStore';
import { useProviderStore, type ProviderEntry } from '../../stores/providerStore';
import { useScreenContextStore } from '../../stores/screenContextStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTurnModeStore } from '../../stores/turnModeStore';
import { useRoutingStore } from '../../stores/routingStore';
import { getEnvironment } from '../../utils/environment';
import { buildSharedSettings } from './shared';
import { gate, participantSpeechInput, planRefusalFor, speakFor, type GateInput, type Refusal, type Speaking, type SpeechInputs } from './shape';
import type { RunShape } from './types';

export function legsFor(mode: 'speaker' | 'participant' | 'both'): LegName[] {
  return mode === 'both' ? ['speaker', 'participant'] : [mode];
}

/** The providers that take a capture area: Qwen, with your own key and managed; they share one settings shape. */
const SCREEN_CONTEXT_PROVIDERS: ReadonlySet<string> = new Set(['qwen_livetranslate', 'kizunaai_qwen']);

/** The provider whose unit transcribes in the plan as the stores stand, and its settings; null until the plan is ready. */
function transcriptionFromStores(): { provider: AnyProvider; settings: unknown } | null {
  const found = planFromStores();
  if (found.state !== 'ready') return null;
  const provider = transcriptionProvider(found.plan);
  return { provider, settings: found.accounts[provider.id].settings };
}

/**
 * The provider whose unit transcribes is a Qwen provider with its Screen
 * context switch on (spec 2026-10-22 §3.1): in the plan a start would run, as
 * `planFromStores` finds it, so a Qwen slice under another provider, or
 * where Qwen is not offered, wants nothing.
 */
export function screenContextWanted(): boolean {
  const transcription = transcriptionFromStores();
  if (!transcription || !SCREEN_CONTEXT_PROVIDERS.has(transcription.provider.id)) return false;
  return (transcription.settings as { screenContext?: unknown }).screenContext === true;
}

/**
 * Start without screen context, chosen in the Start-time picker (owner, 2026-10-22, ruling 3): the transcribing
 * Qwen provider's switch written off, so the setting and the run agree; turning it on again asks again. Nothing under
 * another provider.
 */
export function turnScreenContextOff(): void {
  const transcription = transcriptionFromStores();
  if (!transcription || !SCREEN_CONTEXT_PROVIDERS.has(transcription.provider.id)) return;
  useProviderStore.getState().updateSettings(transcription.provider, { screenContext: false });
}

/**
 * Face-to-face (spec 2026-10-08, slice 3): Both, the other side beside me,
 * under a transcription unit that offers it. The one predicate the run's
 * shape, the capture, the routing and every surface read, so they never
 * disagree; a stored "beside me" under a unit without it is ordinary Both.
 */
export function faceToFaceFromStores(): boolean {
  const { mode, otherSide } = useAudioStore.getState();
  const found = planFromStores();
  return isFaceToFace(found.state === 'ready' ? capabilitiesOf(found, 'transcription') : undefined, mode, otherSide);
}

/** Whether Both with the other side beside me is what the stores ask for, whatever the unit that transcribes offers. */
export function faceToFaceAskedFromStores(): boolean {
  const { mode, otherSide } = useAudioStore.getState();
  return mode === 'both' && otherSide === 'beside';
}

/** `faceToFaceFromStores`' rule over given values, for a surface that subscribes to them. */
export function isFaceToFace(provider: { faceToFace?: boolean } | undefined, mode: AudioMode, otherSide: string): boolean {
  return provider?.faceToFace === true && mode === 'both' && otherSide === 'beside';
}

/**
 * `participantSpeechHeard` over the stores, and the capture's own word: the
 * other's translation, played to me, is not recaptured by the participant
 * source. An application capture that widened to the whole system mid-run
 * (`audioStore`'s `participantCaptureWidened`) recaptures it, whatever the
 * chosen source says.
 */
export function heardFromStores(faceToFace: boolean): boolean {
  const audio = useAudioStore.getState();
  return participantSpeechHeard(getEnvironment(), audio.selectedParticipantSource?.deviceId, faceToFace) && !audio.participantCaptureWidened;
}

/** What the unit that speaks can do, in the plan as the stores stand; undefined until the plan is ready. */
function speechUnitFromStores(): UnitCapabilities | undefined {
  const found = planFromStores();
  return found.state === 'ready' ? capabilitiesOf(found, 'speech') : undefined;
}

/**
 * Who hears what, as the stores stand (spec 2026-10-10 §4): the speech
 * unit's flags (by default) over the switches, the mode, face-to-face and the
 * recapture rule. The run's shape, the live gate's floor, the account
 * button's floor, the routing and every surface read it, so they price
 * and play the same legs. Before the plan is ready it answers as an
 * optional-speech provider would.
 */
export function speechFromStores(speaking: Speaking | undefined = speechUnitFromStores()): Speak {
  const audio = useAudioStore.getState();
  const faceToFace = faceToFaceFromStores();
  return speakFor(speaking ?? { speech: 'optional' }, {
    textOnly: useSettingsStore.getState().textOnly,
    participantSpeech: useRoutingStore.getState().participantSpeech,
    isMonitorMuted: audio.isMonitorMuted,
    legs: legsFor(audio.mode),
    faceToFace,
    heard: heardFromStores(faceToFace),
  });
}

/**
 * Whether a run would speak, besides its legs and its provider, as the
 * stores stand: the text-only switch and the participant's speech (the
 * provider's own flag is `languageContext`'s to apply). The provider store
 * keeps it for the language offer (Stage 2 Volcengine AST2, choice 1).
 */
export function speechInputsFromStores(): SpeechInputs {
  const faceToFace = faceToFaceFromStores();
  return {
    textOnly: useSettingsStore.getState().textOnly,
    participantSpeech: participantSpeechInput({ participantSpeech: useRoutingStore.getState().participantSpeech, faceToFace, heard: heardFromStores(faceToFace) }),
  };
}

/**
 * Whether each provider of the plan speaks, as the stores stand, for its own language lists: the speech unit's
 * rules under the provider that serves the speech stage, and never under any other, which is read by that
 * provider's voice and asked its text offer (`contextFor`). None until the plan is ready: each provider then
 * answers with its own.
 */
export function speakersFromStores(): Record<string, Speaking> {
  const found = planFromStores();
  if (found.state !== 'ready') return {};
  const { speech, participantSpeech } = capabilitiesOf(found, 'speech');
  return Object.fromEntries(providersIn(found.plan).map((p) => [p.id, servesSpeech(found.plan, p) ? { speech, participantSpeech } : { speech: 'never' }]));
}

/**
 * Keeps the provider store's speech inputs on the stores', and who speaks for each provider of the plan, now and
 * on every change, so each provider's pair is one its run could start. Returns the unsubscribe.
 */
export function watchSpeechFromStores(): () => void {
  const apply = () => {
    useProviderStore.getState().setSpeakers(speakersFromStores());
    useProviderStore.getState().setSpeech(speechInputsFromStores());
  };
  apply();
  // Whole-store listeners: `setSpeech` and `setSpeakers` ignore inputs that did not change.
  // A change of the line-up, or a provider's entry landing after it, can turn
  // face-to-face on or off.
  const offs = [
    useSettingsStore.subscribe(apply),
    useRoutingStore.subscribe(apply),
    useAudioStore.subscribe(apply),
    subscribePlan(apply),
  ];
  return () => { for (const off of offs) off(); };
}

/**
 * The plan a start would run and its providers' accounts, as
 * `planFromStores` finds them, with the transcription provider's entry.
 * Null until the plan is ready. The run's shape, the live gate and the
 * account button's floor all read it.
 */
export function runPlanFromStores(): Pick<RunShape, 'plan' | 'accounts'> & { entry: ProviderEntry } | null {
  const found = planFromStores();
  if (found.state !== 'ready') return null;
  // A run's account is a provider's settings and credentials; its pair is the shape's own.
  const accounts = Object.fromEntries(Object.entries(found.accounts).map(([id, { settings, credentials }]) => [id, { settings, credentials }]));
  return { plan: found.plan, accounts, entry: transcriptionAccount(found) };
}

export function readShapeFromStores(auth: AuthContext): RunShape | null {
  const found = runPlanFromStores();
  if (!found) return null;
  const { plan, accounts, entry } = found;
  const heard = transcriptionProvider(plan);
  const st = useSettingsStore.getState();
  const faceToFace = faceToFaceFromStores();
  // Put there before Start, and only once its first frame was in hand (`prepareScreenContext`); a sampler left there
  // after the switch went off or another provider was picked is not this run's.
  const account = useAccountStore.getState().account;
  const payer = accountPayer(account);
  const frames = screenContextWanted() ? useScreenContextStore.getState().sampler?.source : undefined;
  // A stored line-up is what runs, and names the run's stages; until one is stored, so is the line-up shown where this
  // device runs, and the provider that runs names them elsewhere.
  const { lineUp, stored } = lineUpThatRuns();
  return {
    plan,
    accounts,
    lineUp: stageIdsFor(lineUp, stored, heard.id),
    lineUpStored: stored,
    pair: entry.pair,
    legs: legsFor(useAudioStore.getState().mode),
    turnMode: useTurnModeStore.getState().turnMode,
    textOnly: st.textOnly,
    participantSpeech: speechFromStores(capabilitiesOf(found, 'speech')).them,
    faceToFace,
    ...(faceToFaceAskedFromStores() ? { faceToFaceAsked: true } : {}),
    keepReplayAudio: st.keepReplayAudio,
    shared: buildSharedSettings(
      reversedPair(heard, accountOf(found, heard).settings, entry.pair),
      { sourceSeconds: st.segmentationSourcePause, translationSeconds: st.segmentationTranslationPause },
      { mode: st.segmentationMode, sentencesPerRow: st.sentenceSegmentationChunkSentences },
      faceToFace,
      { entries: useWordList.getState().entries, background: useWordList.getState().background },
    ),
    auth,
    account,
    // Who pays is read here, once, at Start; a member's choice, nothing for anyone else.
    ...(payer ? { payer } : {}),
    ...(frames ? { frames } : {}),
  };
}

/**
 * A refusal of the line-up as the stores stand, as the notice every surface words: it names the option of the line-up
 * that runs (`lineUpThatRuns`: the stored one, or the one shown where this device runs before one is stored).
 */
function planRefused(refusal: PlanRefusal): Refusal {
  const { lineUp, stored } = lineUpThatRuns();
  return refusalNotice(refusal, stored ? lineUp : null, presentProviders());
}

/** What `gate` reads, from the stores as they stand; null until the plan is ready. */
function gateInputFromStores(): GateInput | null {
  const found = runPlanFromStores();
  if (!found) return null;
  const account = useAccountStore.getState().account;
  const { lineUp, stored } = lineUpThatRuns();
  return {
    plan: found.plan,
    accounts: found.accounts,
    lineUp: stageIdsFor(lineUp, stored, transcriptionProvider(found.plan).id),
    pair: found.entry.pair,
    legs: legsFor(useAudioStore.getState().mode),
    turnMode: useTurnModeStore.getState().turnMode,
    textOnly: useSettingsStore.getState().textOnly,
    participantSpeech: speechFromStores(capabilitiesOf(found, 'speech')).them,
    faceToFace: faceToFaceFromStores(),
    ...(faceToFaceAskedFromStores() ? { faceToFaceAsked: true } : {}),
    account,
    // The stores as they stand: the payer a Start now would choose.
    payer: accountPayer(account),
  };
}

/**
 * Why the line-up as the stores stand cannot run a session now, for the line-up's own surface: the composer's
 * refusal of the stored line-up, else what its plan cannot do for the pair and the legs a start would open (a
 * voice that does not speak a leg's target). Null when nothing about the line-up is refused, or while the plan
 * is loading.
 */
export function lineUpRefusalFromStores(): PlanRefusal | null {
  const state = planFromStores();
  if (state.state === 'refused') return state.refusal;
  const input = gateInputFromStores();
  return input ? planRefusalFor(input) : null;
}

/** `lineUpRefusalFromStores` as the notice a surface words, with the stage it is about; null when nothing is refused. */
export function lineUpNoticeFromStores(): (Refusal & { stage: PlanRefusal['stage'] }) | null {
  const refusal = lineUpRefusalFromStores();
  return refusal ? { ...planRefused(refusal), stage: refusal.stage } : null;
}

/** The runner's `planRefusal` in the app: why a start has no shape, when the stored line-up is why. */
export function planRefusalFromStores(): Refusal | null {
  const state = planFromStores();
  return state.state === 'refused' ? planRefused(state.refusal) : null;
}

/**
 * The start gate over the stores as they stand (F7): what a start would be
 * refused before anything is checked — a stored line-up the composer cannot
 * run, no leg, a turn mode the provider
 * does not offer, the participant leg on the web or for a pair that does
 * not reverse (D20), a voice that does not speak a leg's target, and a
 * managed provider's wallet still loading,
 * unknown, frozen or below its floor. The surfaces keep Start off and show
 * why; the runner still gates the frozen shape at start. Null when nothing
 * is refused, or while the plan is loading (`providerLoaded` keeps Start
 * off then).
 */
export function liveGate(platform: Platform = getEnvironment()): Refusal | null {
  // A stored line-up the composer refuses: Start stays off, and says the composer's reason.
  const state = planFromStores();
  if (state.state === 'refused') return planRefused(state.refusal);
  const input = gateInputFromStores();
  return input ? gate(input, platform) : null;
}

/** The runner's `ensureReady` in the app: one provider of the shape, with its own inputs from the shape, through the provider store's cache. */
export function ensureReadyFromStores(provider: AnyProvider, shape: RunShape, signal: AbortSignal): Promise<Readiness> {
  const { settings, credentials } = accountOf(shape, provider);
  // The stages it serves in the run's plan, when another provider serves the rest.
  const stages = checkStagesOf(shape.plan, provider);
  return useProviderStore.getState().refreshReadiness(
    provider, shape.auth,
    { settings, credentials, pair: shape.pair, legs: shape.legs, ...(stages ? { stages } : {}) },
    signal,
  );
}

/** Keeps the provider store's `legs` on the audio mode's, now and on every change, so the panel's readiness is about the legs a start would open. Returns the unsubscribe. */
export function watchLegsFromStores(): () => void {
  const apply = (mode: AudioMode) => useProviderStore.getState().setLegs(legsFor(mode));
  apply(useAudioStore.getState().mode);
  return useAudioStore.subscribe((s) => s.mode, apply);
}

/** The microphone's mute, as it stands when the run asks: the runner's `micMuted`. */
export const appMicMuted: { get(): boolean } = {
  get: () => useAudioStore.getState().isMicMuted,
};

/** `keepReplayAudio`, live from the settings store: the runner's `replayAudio`. */
export const appReplayAudio = {
  get: () => useSettingsStore.getState().keepReplayAudio,
  subscribe: (listener: () => void) => useSettingsStore.subscribe((now, before) => {
    if (now.keepReplayAudio !== before.keepReplayAudio) listener();
  }),
};

/**
 * Translation I hear as `speechFromStores` answers it, live: the runner's
 * `participantSpeech` (#595). During a run the provider, the mode and the
 * pair are locked, so only the switch and the capture can move it.
 */
export const appParticipantSpeech = {
  get: () => speechFromStores().them,
  subscribe: (listener: () => void) => {
    let last = speechFromStores().them;
    const check = () => {
      const now = speechFromStores().them;
      if (now === last) return;
      last = now;
      listener();
    };
    const offs = [useRoutingStore.subscribe(check), useAudioStore.subscribe(check)];
    return () => { for (const off of offs) off(); };
  },
};

export function persistIfUnchanged(p: AnyProvider, snapshot: unknown, patch: Readonly<Record<string, unknown>>): void {
  const entry = useProviderStore.getState().entries[p.id];
  if (!entry) return;
  const now = entry.settings as Record<string, unknown>;
  const then = snapshot as Record<string, unknown>;
  const unchanged = Object.fromEntries(Object.entries(patch).filter(([field]) => Object.is(now[field], then[field])));
  if (Object.keys(unchanged).length > 0) useProviderStore.getState().updateSettings(p, unchanged);
}
