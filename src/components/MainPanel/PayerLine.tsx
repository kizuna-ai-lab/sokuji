import { useTranslation } from 'react-i18next';
import { setUseOwnBalance, useUseOwnBalance } from '../../lib/session/payerChoice';
import { useAccountStore } from '../../stores/accountStore';

/**
 * Who pays for the next Start, for a member of an organization: the
 * organization by default, or the member's own balance with the switch on
 * (remembered on this device). Read when Start is pressed; a running session
 * keeps the payer it started with. Nothing for anyone who is not a member.
 */
export default function PayerLine() {
  const { t } = useTranslation();
  const account = useAccountStore((s) => s.account);
  const useOwn = useUseOwnBalance();
  const organization = account?.status === 'known' ? account.organization : undefined;
  if (!organization) return null;
  return (
    <div className="payer-line">
      {!useOwn && <span className="payer-line__paid-by">{t('mainPanel.payer.paidBy', { name: organization.name })}</span>}
      <label className="payer-line__toggle">
        <input type="checkbox" checked={useOwn} onChange={(event) => setUseOwnBalance(event.target.checked)} />
        <span>{t('mainPanel.payer.useOwnBalance')}</span>
      </label>
    </div>
  );
}
