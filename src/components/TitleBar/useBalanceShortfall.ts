/**
 * Whether the account button's dot says the balance is too low to start
 * (choice 9): exactly when the start gate refuses the selected provider's
 * start below its floor — the same computation over the same stores as
 * Start, so the two never disagree (`AccountButton.tsx`'s own rule). A
 * frozen wallet is not a low balance. For an organization payer the dot is only a
 * hint: Start itself is not refused below the floor, the server answers it.
 */
import { balanceRefusal, BALANCE_BELOW_FLOOR } from '../../lib/session/shape';
import { faceToFaceFromStores, legsFor, selectedFromStores, speechFromStores } from '../../lib/session/appShape';
import { ORG_INSUFFICIENT_BALANCE } from '../../lib/session/orgNotice';
import { useAccountPayer } from '../../lib/session/payerChoice';
import { useAccountStore } from '../../stores/accountStore';
import useAudioStore from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useSettingsStore } from '../../stores/settingsStore';

export function useBalanceShortfall(): boolean {
  // Subscribed to what the provider lookup reads, so the dot follows a selection or a load.
  useProviderStore((s) => s.selected);
  useProviderStore((s) => s.entries);
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
  // The provider exactly as the live gate finds it (`selectedFromStores`: the selected one, else the first present), so before the load selects one the dot and Start still agree.
  const found = selectedFromStores();
  if (!found) return false;
  const { provider, entry } = found;
  const participantSpeech = speechFromStores(provider).them;
  const code = balanceRefusal({ provider, settings: entry.settings, legs: legsFor(mode), textOnly, participantSpeech, faceToFace: faceToFaceFromStores(), account, payer })?.code;
  return code === BALANCE_BELOW_FLOOR || code === ORG_INSUFFICIENT_BALANCE;
}
