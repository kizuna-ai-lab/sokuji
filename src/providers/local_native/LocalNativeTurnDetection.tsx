import { useEffect, useMemo } from 'react';
import { useProviderStore } from '../../stores/providerStore';
import { useTurnModeStore } from '../../stores/turnModeStore';
import { useTurnDetectionStore } from '../../stores/turnDetectionStore';
import { useSmartTurnPhase, useSmartTurnStore } from '../../stores/smartTurnStore';
import { TurnDetectionControls, TurnDetectionHelp, TurnDetectionSummary } from '../../components/Settings/turnDetection/TurnDetectionControls';
import { nativeTurnDetectionScope } from '../../lib/turn/turnDetection';
import type { SettingsProps } from '../../lib/provider/types';
import type { LocalNativeSettings as S } from './settings';
import { NATIVE_LIMIT } from './config';

/**
 * Local Native's turn detection is the app's: the same knobs and values (`settings.turnDetection.*`) as every local
 * recognizer, whatever model the sidecar runs. This provider supplies which legs it runs, and the cap its sidecar's
 * backstops put on a segment.
 */
function useScope() {
  const turnMode = useTurnModeStore((s) => s.turnMode);
  const activeLegs = useProviderStore((s) => s.legs);
  const td = useTurnDetectionStore((s) => s.settings);
  const phase = useSmartTurnPhase();
  const scope = useMemo(
    () => nativeTurnDetectionScope(
      [
        ...(activeLegs.includes('speaker') ? [turnMode === 'auto' ? 'auto' as const : 'manual' as const] : []),
        ...(activeLegs.includes('participant') ? ['auto' as const] : []),
      ],
      td,
      NATIVE_LIMIT.maxSpeechSeconds ?? Infinity,
    ),
    [activeLegs, turnMode, td],
  );
  useEffect(() => {
    if (scope.smartOffered && phase === 'unknown') void useSmartTurnStore.getState().refresh();
  }, [scope.smartOffered, phase]);
  return scope;
}

export function LocalNativeTurnDetectionSummary(_props: SettingsProps<S>) {
  return <TurnDetectionSummary scope={useScope()} />;
}

export function LocalNativeTurnDetectionHelp(_props: SettingsProps<S>) {
  return <TurnDetectionHelp scope={useScope()} />;
}

export function LocalNativeTurnDetectionControls({ disabled = false }: SettingsProps<S>) {
  return <TurnDetectionControls scope={useScope()} disabled={disabled} />;
}
