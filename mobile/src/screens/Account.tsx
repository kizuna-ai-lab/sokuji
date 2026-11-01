import { useCallback, useRef, useState } from 'react';
import { View, type HostInstance } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { KeyRound, LogOut, ReceiptText, Trash2 } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Notice } from '@/components/Notice';
import { Row, RowGroup } from '@/components/Row';
import { Screen } from '@/components/ScreenHeader';
import { Spinner } from '@/components/Spinner';
import { useBusy } from '@/lib/useBusy';
import { deleteAccount, emailVerified } from '../auth/client';
import { authErrorKey } from '../auth/unwrap';
import { fetchFallbackUsdPerHour, fetchUsagePerHour, fetchWallet, type Wallet } from '../account/wallet';
import { formatHours, hoursLeft } from '../account/hours';
import { formatUsd } from '../account/money';
import { useApp } from '../navigation/context';
import type { AppNavigation } from '../navigation/routes';
import { useSessionActive } from '../store/useSessionActive';

// The account screen: the balance and what it buys, as the website's billing
// page shows them (R12: the balance only, top-ups in words); verify, usage,
// sign out, delete.
export default function Account() {
  const { t, i18n } = useTranslation();
  const { token, email, onSignOut, onAccountDeleted: onDeleted, onSignInRequired } = useApp();
  const navigation = useNavigation<AppNavigation>();
  // A session is running: signing out or deleting would leave it recording behind the sign-in screen.
  const locked = useSessionActive();
  const locale = i18n.language.replace('_', '-');
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [hours, setHours] = useState<string | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [deleting, runDelete] = useBusy();
  const [signingOut, runSignOut] = useBusy();
  const deleteRow = useRef<HostInstance>(null);
  // A lost session goes to the sign-in screen; anything else is shown.
  const show = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    const key = authErrorKey(err);
    if (key) setError(t(key));
    else if (message === 'sign_in_required') onSignInRequired();
    else {
      // The detail is for the log; the screen says it in words (design scope: no raw service errors).
      console.warn(`account: ${message}`);
      setError(t('mobile.common.failed'));
    }
  };
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });

  const load = useCallback(async () => {
    setError('');
    try {
      const [w, rate, fallback, v] = await Promise.all([
        fetchWallet({ token }),
        fetchUsagePerHour({ token }).catch(() => null),
        fetchFallbackUsdPerHour({}).catch(() => 0),
        emailVerified().catch(() => null),
      ]);
      setWallet(w);
      const h = hoursLeft(w.balanceUsd, rate, fallback);
      setHours(rate !== null || fallback > 0 ? formatHours(h) : null);
      setVerified(v);
    } catch (err) {
      show(err);
    }
  }, [token]);

  // Loaded when the screen shows, and again when a verify or password page returns to it.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  function deleteNow() {
    void runDelete(async () => {
      setError('');
      try {
        await deleteAccount();
        onDeleted();
      } catch (err) {
        show(err);
      }
    });
  }

  const lockedReason = t('mobile.settings.locked');
  return (
    <Screen>
      <View className="gap-3 px-4">
        <Text className="text-muted-foreground">{email}</Text>
        {!wallet && !error ? <Spinner size="large" className="py-6" /> : null}
        {wallet ? (
          // Balance first and largest; the rest under it, one line each, so a narrow screen or large text never squeezes them side by side.
          <View className="border-border bg-card gap-2 rounded-lg border p-4">
            <Text className="text-muted-foreground text-sm">{t('mobile.account.balance')}</Text>
            <Text className="text-4xl font-semibold">{formatUsd(wallet.balanceUsd)}</Text>
            {hours !== null ? <Text>{t('mobile.account.hoursLeft', { hours })}</Text> : null}
            <View className="border-border mt-1 gap-0.5 border-t pt-3">
              <Text className="text-muted-foreground text-sm">{t('mobile.account.usage30d')}</Text>
              <Text className="text-lg font-semibold">{formatUsd(wallet.last30DaysUsd)}</Text>
            </View>
            {wallet.frozen ? <Notice tone="error">{t('mobile.account.frozen')}</Notice> : null}
            {wallet.expiringSoon ? (
              <Notice>{t('mobile.account.expiring', { amount: formatUsd(wallet.expiringSoon.usd), date: day.format(new Date(wallet.expiringSoon.expiresAt)) })}</Notice>
            ) : null}
            <Text className="text-muted-foreground text-sm">{t('mobile.account.topUp')}</Text>
          </View>
        ) : null}
        {verified === false ? (
          <View className="border-border gap-3 rounded-lg border p-4">
            <Notice>{t('mobile.account.verify')}</Notice>
            <Button variant="outline" onPress={() => navigation.navigate('Verify')}>
              <Text>{t('mobile.signIn.verify')}</Text>
            </Button>
          </View>
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
      </View>
      <RowGroup>
        <Row icon={ReceiptText} label={t('mobile.account.usage')} onPress={() => navigation.navigate('Usage')} />
        {/* Verify the address, or set / change the password (owner, 2026-10-28): the page sends nothing until asked. */}
        <Row icon={KeyRound} label={t('mobile.signIn.password')} onPress={() => navigation.navigate('Password')} />
      </RowGroup>
      <RowGroup>
        <Row
          icon={LogOut}
          label={t('mobile.account.signOut')}
          destructive
          disabled={locked || signingOut}
          disabledReason={locked ? lockedReason : undefined}
          accessory={signingOut ? <Spinner /> : undefined}
          chevron={false}
          onPress={() => {
            void runSignOut(async () => {
              try {
                await onSignOut();
              } catch (err) {
                show(err);
              }
            });
          }}
        />
        <Row
          ref={deleteRow}
          icon={Trash2}
          label={t('mobile.account.deleteAccount')}
          destructive
          disabled={locked || deleting}
          disabledReason={locked ? lockedReason : undefined}
          accessory={deleting ? <Spinner /> : undefined}
          chevron={false}
          onPress={() => setConfirming(true)}
        />
      </RowGroup>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('mobile.account.deleteAccount')}
        description={t('mobile.account.deleteConfirm')}
        confirmLabel={t('mobile.account.deleteAccount')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={deleteNow}
        returnTo={deleteRow}
      />
    </Screen>
  );
}
