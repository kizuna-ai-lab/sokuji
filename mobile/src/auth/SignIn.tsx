import { useEffect, useState } from 'react';
import { Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { requestPasswordReset, resetPassword, sendVerificationCode, signIn, signUp, verifyEmail } from './client';
import { authErrorKey } from './unwrap';

type Mode = 'signin' | 'register' | 'verify' | 'forgot' | 'reset';

// Sending a code is rate-limited by the backend; the button waits this long
// between sends and says so.
const RESEND_WAIT_S = 60;

export default function SignIn({
  onSignedIn,
  initialMode = 'signin',
  initialEmail = '',
  onBack,
}: {
  onSignedIn: (email: string) => void;
  /** The account screen opens the code screen for an address whose code was just sent. */
  initialMode?: Mode;
  initialEmail?: string;
  onBack?: () => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function run(action: () => Promise<void>, after?: () => void) {
    setBusy(true);
    setError('');
    try {
      await action();
      after?.();
    } catch (err) {
      const key = authErrorKey(err);
      setError(key ? t(key) : err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const address = email.trim();
  const otp = code.trim();

  function go(next: Mode) {
    setError('');
    setCode('');
    setMode(next);
  }

  async function sendCode() {
    await sendVerificationCode(address);
    setResendIn(RESEND_WAIT_S);
  }

  const emailField = (
    <TextInput
      style={styles.input}
      placeholder={t('mobile.signIn.email')}
      autoCapitalize="none"
      autoComplete="email"
      keyboardType="email-address"
      value={email}
      onChangeText={setEmail}
    />
  );
  const passwordField = (newPassword = false) => (
    <TextInput
      style={styles.input}
      placeholder={newPassword ? `${t('mobile.signIn.newPassword')} (${t('mobile.signIn.passwordHint')})` : t('mobile.signIn.password')}
      secureTextEntry
      autoComplete={newPassword ? 'new-password' : 'password'}
      value={password}
      onChangeText={setPassword}
    />
  );
  const codeField = (
    <TextInput
      style={styles.input}
      placeholder={t('mobile.signIn.code')}
      keyboardType="number-pad"
      textContentType="oneTimeCode"
      autoComplete="one-time-code"
      maxLength={6}
      value={code}
      onChangeText={setCode}
    />
  );
  const resend = (
    <Button
      title={resendIn > 0 ? t('mobile.signIn.sendAgainIn', { seconds: resendIn }) : t('mobile.signIn.sendAgain')}
      disabled={busy || resendIn > 0}
      onPress={() => run(sendCode)}
    />
  );

  return (
    <View style={styles.box}>
      {(mode === 'signin' || mode === 'register') && (
        <View style={styles.tabs}>
          <Text accessibilityRole="button" style={[styles.tab, mode === 'signin' && styles.tabOn]} onPress={() => go('signin')}>{t('mobile.signIn.title')}</Text>
          <Text accessibilityRole="button" style={[styles.tab, mode === 'register' && styles.tabOn]} onPress={() => go('register')}>{t('mobile.signIn.register')}</Text>
        </View>
      )}

      {mode === 'signin' && (
        <>
          {emailField}
          {passwordField()}
          <Button
            title={t('mobile.signIn.submit')}
            disabled={busy || !address || !password}
            onPress={() => run(() => signIn(address, password), () => onSignedIn(address))}
          />
          <Text accessibilityRole="button" style={styles.link} onPress={() => go('forgot')}>{t('mobile.signIn.forgot')}</Text>
        </>
      )}

      {mode === 'register' && (
        <>
          {emailField}
          {passwordField(true)}
          <Button
            title={t('mobile.signIn.register')}
            disabled={busy || !address || password.length < 8}
            onPress={() => run(async () => { await signUp(address, password); await sendCode(); }, () => go('verify'))}
          />
          <Text style={styles.note}>{t('mobile.signIn.registerNote')}</Text>
        </>
      )}

      {mode === 'verify' && (
        <>
          <Text style={styles.title}>{t('mobile.signIn.verifyTitle')}</Text>
          <Text style={styles.note}>{t('mobile.signIn.codeSent', { email: address })}</Text>
          {codeField}
          <Button
            title={t('mobile.signIn.verify')}
            disabled={busy || otp.length !== 6}
            onPress={() => run(() => verifyEmail(address, otp), () => onSignedIn(address))}
          />
          {resend}
          <Text accessibilityRole="button" style={styles.link} onPress={() => (onBack ? onBack() : onSignedIn(address))}>{onBack ? t('mobile.common.back') : t('mobile.signIn.later')}</Text>
        </>
      )}

      {mode === 'forgot' && (
        <>
          <Text style={styles.title}>{t('mobile.signIn.resetTitle')}</Text>
          {emailField}
          <Button
            title={t('mobile.signIn.sendCode')}
            disabled={busy || !address}
            onPress={() => run(async () => { await requestPasswordReset(address); setResendIn(RESEND_WAIT_S); }, () => go('reset'))}
          />
          <Text accessibilityRole="button" style={styles.link} onPress={() => go('signin')}>{t('mobile.signIn.back')}</Text>
        </>
      )}

      {mode === 'reset' && (
        <>
          <Text style={styles.title}>{t('mobile.signIn.resetTitle')}</Text>
          <Text style={styles.note}>{t('mobile.signIn.codeSent', { email: address })}</Text>
          {codeField}
          {passwordField(true)}
          <Button
            title={t('mobile.signIn.setNewPassword')}
            disabled={busy || otp.length !== 6 || password.length < 8}
            onPress={() => run(async () => { await resetPassword(address, otp, password); await signIn(address, password); }, () => onSignedIn(address))}
          />
          <Button
            title={resendIn > 0 ? t('mobile.signIn.sendAgainIn', { seconds: resendIn }) : t('mobile.signIn.sendAgain')}
            disabled={busy || resendIn > 0}
            onPress={() => run(async () => { await requestPasswordReset(address); setResendIn(RESEND_WAIT_S); })}
          />
          <Text accessibilityRole="button" style={styles.link} onPress={() => (onBack ? onBack() : go('signin'))}>{onBack ? t('mobile.common.back') : t('mobile.signIn.back')}</Text>
        </>
      )}

      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { padding: 24, gap: 12, width: '100%' },
  tabs: { flexDirection: 'row', borderWidth: 1, borderColor: '#ccc', borderRadius: 8, overflow: 'hidden' },
  tab: { flex: 1, textAlign: 'center', paddingVertical: 8, color: '#333' },
  tabOn: { backgroundColor: '#e3eefb', color: '#1e63c4', fontWeight: '600' },
  title: { fontSize: 20, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 10, fontSize: 16 },
  note: { fontSize: 12, color: '#666' },
  link: { color: '#1e63c4', paddingVertical: 4 },
  error: { color: '#c0392b' },
});
