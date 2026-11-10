import { useTranslation } from 'react-i18next';
import { setUseOwnBalance, useUseOwnBalance } from '../../lib/session/payerChoice';
import type { Payer } from '../../lib/session/types';
import { selectedFromStores } from '../../lib/session/appShape';
import { useAccountStore } from '../../stores/accountStore';
import { useProviderStore } from '../../stores/providerStore';
import ToggleSwitch from '../Settings/shared/ToggleSwitch';

/**
 * Who pays for the next Start, for a member of an organization using a
 * provider that bills a balance: the organization by default, or the
 * member's own balance with the switch on (remembered on this device). The
 * payer is chosen at Start and a running session keeps it, so the switch is
 * off-limits until the session ends. Nothing for anyone else.
 */
export default function PayerLine({ idle, runPayer }: {
  idle: boolean;
  /** The payer the running session was started with: shown while it runs, whatever the switch now says (another window can change it). */
  runPayer?: Payer;
}) {
  const { t } = useTranslation();
  const account = useAccountStore((s) => s.account);
  const switchOn = useUseOwnBalance();
  // Idle: the switch, for the next Start. Running: the payer the session was started with.
  const useOwn = idle ? switchOn : runPayer === 'personal';
  // Subscribed to what the provider lookup reads, so the line follows a selection or a load.
  useProviderStore((s) => s.selected);
  useProviderStore((s) => s.entries);
  const organization = account?.status === 'known' ? account.organization : undefined;
  // The gate's own test for a provider that bills a balance.
  if (!organization || !selectedFromStores()?.provider.session?.minimumBalance) return null;
  // A session started with no payer (the account was not known as a member then): who pays is not ours to guess.
  if (!idle && !runPayer) return null;
  return (
    <div className="payer-line">
      <span className="payer-line__paid-by">{useOwn ? t('mainPanel.payer.paidByYou') : t('mainPanel.payer.paidBy', { name: organization.name })}</span>
      <ToggleSwitch
        className="payer-line__toggle"
        checked={useOwn}
        onChange={() => setUseOwnBalance(!switchOn)}
        label={t('mainPanel.payer.useOwnBalance')}
        ariaLabel={t('mainPanel.payer.useOwnBalance')}
        disabled={!idle}
      />
    </div>
  );
}
