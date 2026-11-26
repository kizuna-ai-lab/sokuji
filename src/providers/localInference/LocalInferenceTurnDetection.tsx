import { useEffect, useMemo } from 'react';
import { useModelStore, useModelStatuses } from '../../stores/modelStore';
import { useProviderStore } from '../../stores/providerStore';
import { useStoredLocalStages } from '../../stores/lineUpStore';
import { ALL_LOCAL_STAGES } from '../../lib/lineup/localStages';
import { useTurnModeStore } from '../../stores/turnModeStore';
import { useTurnDetectionStore } from '../../stores/turnDetectionStore';
import { useSmartTurnPhase, useSmartTurnStore } from '../../stores/smartTurnStore';
import { getManifestEntry } from '../../lib/local-inference/modelManifest';
import { turnDetectionScope, type TurnDetectionLeg } from '../../lib/turn/turnDetection';
import { TurnDetectionControls, TurnDetectionHelp, TurnDetectionSummary } from '../../components/Settings/turnDetection/TurnDetectionControls';
import type { SettingsProps } from '../../lib/provider/types';
import type { LanguagePair } from '../../lib/run/types';
import { resolveLocal, translatesSpeechDirectly } from './config';
import type { LocalInferenceSettings as S } from './settings';

/**
 * The legs whose resolved recognizer takes our turn detection: the speaker's (turns follow the turn mode) and the
 * participant's (always automatic), each only while `providerStore.legs` names it. Refreshes the Smart Turn model's
 * state once a leg offers Smart.
 */
function useTurnDetectionLegs(settings: S, pair: LanguagePair | undefined): TurnDetectionLeg[] {
  // `localInferenceLanguages.initial()` gives the same fallback; the Speech section always supplies `pair` in the
  // app, so this only matters standalone.
  const source = pair?.source ?? 'ja';
  const target = pair?.target ?? 'en';
  // Forces a recompute when a model finishes downloading elsewhere.
  const modelStatuses = useModelStatuses();
  const turnMode = useTurnModeStore((s) => s.turnMode);
  const activeLegs = useProviderStore((s) => s.legs);
  // The stages the run serves, as the builders resolve them: a translation pick left in the selections does not
  // make a leg translate when another provider translates.
  const stages = useStoredLocalStages() ?? ALL_LOCAL_STAGES;
  const phase = useSmartTurnPhase();
  const td = useTurnDetectionStore((s) => s.settings);
  const legs = useMemo(() => {
    const leg = (from: string, to: string, turns: 'auto' | 'manual'): TurnDetectionLeg => {
      const resolved = resolveLocal({ source: from, target: to }, settings, stages, useModelStore.getState());
      const asrId = resolved.asr?.modelId;
      return {
        entry: getManifestEntry(asrId ?? ''),
        turns,
        task: translatesSpeechDirectly(asrId, resolved.translation?.modelId) ? 'translate' : 'transcribe',
        language: from,
      };
    };
    const out: TurnDetectionLeg[] = [];
    if (activeLegs.includes('speaker')) out.push(leg(source, target, turnMode === 'auto' ? 'auto' : 'manual'));
    if (activeLegs.includes('participant')) out.push(leg(target, source, 'auto'));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `modelStatuses` is the recompute trigger
  }, [source, target, settings, stages, modelStatuses, turnMode, activeLegs]);
  const smartOffered = turnDetectionScope(legs, td).smartOffered;
  useEffect(() => {
    if (smartOffered && phase === 'unknown') void useSmartTurnStore.getState().refresh();
  }, [smartOffered, phase]);
  return legs;
}

function useScope(settings: S, pair: LanguagePair | undefined) {
  const legs = useTurnDetectionLegs(settings, pair);
  const td = useTurnDetectionStore((s) => s.settings);
  return useMemo(() => turnDetectionScope(legs, td), [legs, td]);
}

/** The Speech section's one line, under Auto. The values and the knobs are the app's (`useTurnDetectionStore`); this provider supplies which legs it runs. */
export function LocalInferenceTurnDetectionSummary({ settings, pair }: SettingsProps<S>) {
  return <TurnDetectionSummary scope={useScope(settings, pair)} />;
}

export function LocalInferenceTurnDetectionHelp({ settings, pair }: SettingsProps<S>) {
  return <TurnDetectionHelp scope={useScope(settings, pair)} />;
}

export function LocalInferenceTurnDetectionControls({ settings, disabled = false, pair }: SettingsProps<S>) {
  return <TurnDetectionControls scope={useScope(settings, pair)} disabled={disabled} />;
}
