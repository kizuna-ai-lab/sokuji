// src/components/providers/stageParts.tsx
//
// A provider's settings, cut by the stage they act on (mock v19, the owner's 2026-11-15 call). The line-up page draws
// a provider's `Settings` once per stage card it serves, inside `SettingsStage`; each row the provider wraps in
// `StagePart` says which stages it acts on. A card shows its own stage's rows; a row acting on several of the stages
// the provider serves shows once, in the first of those cards, with a line naming them. Outside a stage card (no
// `SettingsStage`) every row shows, as before.
import { createContext, useContext, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { RUN_STAGES, type RunStage } from '../../lib/lineup/types';
import { stageInSentence } from '../../lib/lineup/stageWords';

interface StageScope {
  /** The card being drawn. */
  stage: RunStage;
  /** Every stage this provider serves in the line-up. */
  served: readonly RunStage[];
}

const SettingsStageContext = createContext<StageScope | null>(null);

/** Draw a provider's settings for one stage card. */
export function SettingsStage({ stage, served, children }: StageScope & { children: ReactNode }) {
  return <SettingsStageContext.Provider value={{ stage, served }}>{children}</SettingsStageContext.Provider>;
}

/** The card being drawn, or null outside a stage card. */
export function useSettingsStage(): StageScope | null {
  return useContext(SettingsStageContext);
}

/** The served stages a row acting on `stages` acts on, in line-up order. */
export function actingOn(stages: readonly RunStage[], served: readonly RunStage[]): RunStage[] {
  return RUN_STAGES.filter((s) => stages.includes(s) && served.includes(s));
}

/** Whether the current card shows a row acting on `stages`, and the stages to name when it acts on several. */
export function useStagePart(stages: readonly RunStage[]): { show: boolean; actsOn: RunStage[] | null } {
  const scope = useSettingsStage();
  if (!scope) return { show: true, actsOn: null };
  const acts = actingOn(stages, scope.served);
  if (acts.length === 0) return { show: false, actsOn: null };
  if (acts.length === 1) return { show: acts[0] === scope.stage, actsOn: null };
  return { show: acts[0] === scope.stage, actsOn: acts };
}

/** "transcription, translation and speech", in the reader's language. */
export function useStageList(): (stages: readonly RunStage[]) => string {
  const { t, i18n } = useTranslation();
  const name = (s: RunStage) => stageInSentence(t(`settingsPage.lineup.stages.${s}`, STAGE_TITLES[s]), i18n?.language ?? 'en');
  return (stages) => {
    const names = stages.map(name);
    if (names.length < 2) return names.join('');
    return names.slice(0, -1).join(t('models.page.listJoin', ', ')) + t('settingsPage.lineup.and', ' and ') + names[names.length - 1];
  };
}

const STAGE_TITLES: Record<RunStage, string> = { transcription: 'Transcription', translation: 'Translation', speech: 'Speech' };

/** One of a provider's settings, acting on `stages`. */
export function StagePart({ stages, children }: { stages: readonly RunStage[]; children: ReactNode }) {
  const { t } = useTranslation();
  const list = useStageList();
  const { show, actsOn } = useStagePart(stages);
  if (!show) return null;
  if (!actsOn) return <>{children}</>;
  return (
    <div className="stage-part">
      {children}
      <small className="stage-part__acts">{t('settingsPage.lineup.actsOn', 'Acts on {{stages}}', { stages: list(actsOn) })}</small>
    </div>
  );
}

/**
 * Whether a stage card has options for its provider, from the provider's `optionStages`: its own stage's, or the
 * ones acting on several served stages when it is the first of them; a later card points back to that first card,
 * naming the stages those options act on. Turn detection belongs to transcription. Without a declaration, every
 * option shows in the provider's first card.
 */
export function cardOptions(
  optionStages: readonly (readonly RunStage[])[] | undefined,
  served: readonly RunStage[],
  stage: RunStage,
  hasTurnDetection: boolean,
): { has: boolean; rows: boolean; pointerTo: RunStage | null; pointerStages: RunStage[] } {
  const first = RUN_STAGES.find((s) => served.includes(s));
  if (!optionStages) return { has: stage === first, rows: stage === first, pointerTo: null, pointerStages: [] };
  const acts = optionStages.map((st) => actingOn(st, served)).filter((a) => a.length > 0);
  const own = acts.some((a) => a.length === 1 && a[0] === stage) || (stage === 'transcription' && hasTurnDetection);
  const sharedHere = acts.some((a) => a.length > 1 && a[0] === stage);
  const elsewhere = acts.filter((a) => a.length > 1 && a[0] !== stage && a.includes(stage));
  const pointerTo = elsewhere.length > 0 ? elsewhere[0][0] : null;
  const pointerStages = RUN_STAGES.filter((s) => elsewhere.some((a) => a.includes(s)));
  // `rows`: the card draws options of its own (not only the pointer to another card's).
  return { has: own || sharedHere || pointerTo !== null, rows: own || sharedHere, pointerTo, pointerStages };
}
