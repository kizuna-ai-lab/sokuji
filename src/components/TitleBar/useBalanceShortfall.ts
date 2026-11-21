/**
 * Whether the account button's dot says the balance is too low to start
 * (choice 9): exactly when the start gate refuses a start of the plan
 * below its providers' floor — the same computation over the same stores as
 * Start, so the two never disagree (`AccountButton.tsx`'s own rule). A
 * frozen wallet is not a low balance. For an organization payer the dot is only a
 * hint: Start itself is not refused below the floor, the server answers it.
 */
import { usePlan } from '../../lib/plan/fromStores';
import { capabilitiesOf } from '../../lib/plan/read';
import { balanceRefusal, BALANCE_BELOW_FLOOR } from '../../lib/session/shape';
import { faceToFaceFromStores, legsFor, runPlanFromStores, speechFromStores } from '../../lib/session/appShape';
import { ORG_INSUFFICIENT_BALANCE } from '../../lib/session/orgNotice';
import { useAccountPayer } from '../../lib/session/payerChoice';
import { useAccountStore } from '../../stores/accountStore';
import useAudioStore from '../../stores/audioStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useSettingsStore } from '../../stores/settingsStore';

export function useBalanceShortfall(): boolean {
  // Subscribed to the plan, so the dot follows a change of it or of its providers' entries.
  usePlan();
  const mode = useAudioStore((s) => s.mode);
  // Face-to-face reads the mode and this, so the dot follows the other side too.
  useAudioStore((s) => s.otherSide);
  const textOnly = useSettingsStore((s) => s.textOnly);
  const account = useAccountStore((s) => s.account);
  // Which wallet the gate checks follows the payer switch.
  const payer = useAccountPayer(account);
  // What `speechFromStores` reads, subscribed so the dot follows the switch and the source.
  useRoutingStore((s) => s.participantSpeech);
  useAudioStore((s) => s.selectedParticipantSource?.deviceId);
  useAudioStore((s) => s.participantCaptureWidened);
  // The plan exactly as the live gate finds it (`runPlanFromStores`), so the dot and Start agree; none while it is loading or refused.
  const found = runPlanFromStores();
  if (!found) return false;
  const participantSpeech = speechFromStores(capabilitiesOf(found, 'speech')).them;
  const code = balanceRefusal({ plan: found.plan, accounts: found.accounts, legs: legsFor(mode), textOnly, participantSpeech, faceToFace: faceToFaceFromStores(), account, payer })?.code;
  return code === BALANCE_BELOW_FLOOR || code === ORG_INSUFFICIENT_BALANCE;
}
