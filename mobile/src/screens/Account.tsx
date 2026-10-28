import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Button, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { deleteAccount, emailVerified, requestPasswordReset, sendVerificationCode } from '../auth/client';
import SignIn from '../auth/SignIn';
import { fetchFallbackUsdPerHour, fetchUsagePerHour, fetchWallet, type Wallet } from '../account/wallet';
import { formatHours, hoursLeft } from '../account/hours';
import { formatUsd } from '../account/money';
import Usage from './Usage';

// The account screen: the balance and what it buys, as the website's billing
// page shows them (R12: the balance only, top-ups in words); verify, usage,
// sign out, delete.
export default function Account({
  token,
  email,
  onBack,
  onSignOut,
  onDeleted,
  locked,
  onSignInRequired,
}: {
  token: string;
  email: string;
  onBack: () => void;
  onSignOut: () => void;
  onDeleted: () => void;
  /** A session is running: signing out or deleting would leave it recording behind the sign-in screen. */
  locked: boolean;
  onSignInRequired: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.replace('_', '-');
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [hours, setHours] = useState<string | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<'account' | 'usage' | 'verify' | 'password'>('account');
  // A lost session goes to the sign-in screen; anything else is shown.
  const show = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'sign_in_required') onSignInRequired();
    else {
      console.warn(`account: ${message}`);
      setError(message);
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

  useEffect(() => {
    void load();
  }, [load]);

  async function startVerify() {
    setError('');
    try {
      await sendVerificationCode(email);
      setView('verify');
    } catch (err) {
      show(err);
    }
  }

  // Set or change the password: a code to the address, then the new password —
  // the same reset flow as "forgot", so an account that only ever signed in
  // with a code gets a password here too.
  async function startPasswordChange() {
    setError('');
    try {
      await requestPasswordReset(email);
      setView('password');
    } catch (err) {
      show(err);
    }
  }

  function confirmDelete() {
    Alert.alert(t('mobile.account.deleteAccount'), t('mobile.account.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('mobile.account.deleteAccount'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteAccount();
            onDeleted();
          } catch (err) {
            show(err);
          }
        },
      },
    ]);
  }

  if (view === 'usage') return <Usage token={token} onBack={() => setView('account')} onSignInRequired={onSignInRequired} />;
  if (view === 'verify' || view === 'password') {
    return (
      <SignIn
        initialMode={view === 'verify' ? 'verify' : 'reset'}
        initialEmail={email}
        onSignedIn={() => { setView('account'); void load(); }}
        onBack={() => setView('account')}
      />
    );
  }

  return (
    <View style={styles.box}>
      <View style={styles.header}>
        <Text accessibilityRole="button" style={styles.link} onPress={onBack}>‹ {t('mobile.common.back')}</Text>
        <Text style={styles.title}>{t('mobile.menu.account')}</Text>
        <Text style={styles.link}> </Text>
      </View>
      <Text style={styles.quiet}>{email}</Text>
      {!wallet && !error && <ActivityIndicator style={styles.loading} />}
      {wallet && (
        <View style={styles.balance}>
          <View style={styles.stats}>
            <View>
              <Text style={styles.quiet}>{t('mobile.account.balance')}</Text>
              <Text style={styles.big}>{formatUsd(wallet.balanceUsd)}</Text>
            </View>
            <View style={styles.right}>
              <Text style={styles.quiet}>{t('mobile.account.usage30d')}</Text>
              <Text style={styles.mid}>{formatUsd(wallet.last30DaysUsd)}</Text>
            </View>
          </View>
          {hours !== null && <Text style={styles.quiet}>{t('mobile.account.hoursLeft', { hours })}</Text>}
          {wallet.frozen && <Text style={styles.warn}>{t('mobile.account.frozen')}</Text>}
          {wallet.expiringSoon && (
            <Text style={styles.quiet}>
              {t('mobile.account.expiring', { amount: formatUsd(wallet.expiringSoon.usd), date: day.format(new Date(wallet.expiringSoon.expiresAt)) })}
            </Text>
          )}
          <Text style={styles.quiet}>{t('mobile.account.topUp')}</Text>
        </View>
      )}
      {verified === false && (
        <View style={styles.verify}>
          <Text style={styles.verifyText}>{t('mobile.account.verify')}</Text>
          <Button title={t('mobile.signIn.verify')} onPress={startVerify} />
        </View>
      )}
      <Text accessibilityRole="button" style={styles.row} onPress={() => setView('usage')}>{t('mobile.account.usage')}  ›</Text>
      <Text accessibilityRole="button" style={styles.row} onPress={startPasswordChange}>{t('mobile.signIn.password')}  ›</Text>
      <Text accessibilityRole="button" accessibilityState={{ disabled: locked }} style={[styles.row, locked ? styles.disabled : styles.danger]} onPress={locked ? undefined : onSignOut}>{t('mobile.account.signOut')}</Text>
      <Text accessibilityRole="button" accessibilityState={{ disabled: locked }} style={[styles.row, locked && styles.disabled]} onPress={locked ? undefined : confirmDelete}>{t('mobile.account.deleteAccount')}  ›</Text>
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, width: '100%', padding: 12, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontWeight: '600', fontSize: 17 },
  link: { color: '#1e63c4', minWidth: 60 },
  quiet: { color: '#666', fontSize: 13 },
  loading: { paddingVertical: 24 },
  balance: { gap: 6, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ddd' },
  stats: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  right: { alignItems: 'flex-end' },
  big: { fontSize: 28, fontWeight: '600' },
  mid: { fontSize: 17, fontWeight: '600' },
  warn: { color: '#b00', fontWeight: '600' },
  verify: { gap: 6, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ddd' },
  verifyText: { color: '#8a5a00' },
  row: { fontSize: 17, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ddd' },
  danger: { color: '#c0392b' },
  disabled: { color: '#aaa' },
  error: { color: '#c0392b' },
});
