// src/lib/session/useLineUpNotice.ts
//
// `lineUpNoticeFromStores` for a component: it follows every store value the
// answer is read from, so the line it words is never an older answer.
import { useMemo } from 'react';
import { usePlan } from '../plan/fromStores';
import { useAccountStore } from '../../stores/accountStore';
import useAudioStore from '../../stores/audioStore';
import { useLineUpStore } from '../../stores/lineUpStore';
import { useRoutingStore } from '../../stores/routingStore';
import useSettingsStore from '../../stores/settingsStore';
import { useTurnModeStore } from '../../stores/turnModeStore';
import { lineUpNoticeFromStores } from './appShape';

/**
 * Why the line-up as the stores stand cannot run a session now, as the notice a surface words, with the stage it
 * is about; null when nothing is refused or while the plan is loading. The component renders again when the plan
 * (the line-up, a provider of it, its settings or its pair), the mode, who hears, the participant's source or the
 * turn mode changes; the same object until one of them does.
 */
export function useLineUpNotice(): ReturnType<typeof lineUpNoticeFromStores> {
  // The plan and its accounts: the composer's refusal, the pair and the speech unit's settings.
  const plan = usePlan();
  // The option a refusal names.
  const lineUp = useLineUpStore((s) => s.lineUp);
  const stored = useLineUpStore((s) => s.stored);
  // The legs a start would open, and face-to-face.
  const mode = useAudioStore((s) => s.mode);
  const otherSide = useAudioStore((s) => s.otherSide);
  // Whether the participant's translation may be read aloud: its source, and a capture widened to the whole system.
  const participantSource = useAudioStore((s) => s.selectedParticipantSource?.deviceId);
  const widened = useAudioStore((s) => s.participantCaptureWidened);
  // Who hears.
  const textOnly = useSettingsStore((s) => s.textOnly);
  const participantSpeech = useRoutingStore((s) => s.participantSpeech);
  // The rest of what the gate's input reads.
  const turnMode = useTurnModeStore((s) => s.turnMode);
  const account = useAccountStore((s) => s.account);
  return useMemo(
    () => lineUpNoticeFromStores(),
    [plan, lineUp, stored, mode, otherSide, participantSource, widened, textOnly, participantSpeech, turnMode, account],
  );
}
