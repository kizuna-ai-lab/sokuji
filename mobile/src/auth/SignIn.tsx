import { useEffect, useState } from 'react';
import { Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { requestPasswordReset, resetPassword, sendVerificationCode, signIn, signUp, verifyEmail } from './client';

type Mode = 'signin' | 'register' | 'verify' | 'forgot' | 'reset';

// Sending a code is rate-limited by the backend; the button waits this long
// between sends and says so.
const RESEND_WAIT_S = 60;

export default function SignIn({ onSignedIn }: { onSignedIn: (email: string) => void }) {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
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
      setError(err instanceof Error ? err.message : String(err));
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
      placeholder="Email"
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
      placeholder={newPassword ? 'New password (at least 8 characters)' : 'Password'}
      secureTextEntry
      autoComplete={newPassword ? 'new-password' : 'password'}
      value={password}
      onChangeText={setPassword}
    />
  );
  const codeField = (
    <TextInput
      style={styles.input}
      placeholder="Code from the email"
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
      title={resendIn > 0 ? `Send again (${resendIn} s)` : 'Send again'}
      disabled={busy || resendIn > 0}
      onPress={() => run(sendCode)}
    />
  );

  return (
    <View style={styles.box}>
      {(mode === 'signin' || mode === 'register') && (
        <View style={styles.tabs}>
          <Text style={[styles.tab, mode === 'signin' && styles.tabOn]} onPress={() => go('signin')}>Sign in</Text>
          <Text style={[styles.tab, mode === 'register' && styles.tabOn]} onPress={() => go('register')}>Create account</Text>
        </View>
      )}

      {mode === 'signin' && (
        <>
          {emailField}
          {passwordField()}
          <Button
            title="Sign in"
            disabled={busy || !address || !password}
            onPress={() => run(() => signIn(address, password), () => onSignedIn(address))}
          />
          <Text style={styles.link} onPress={() => go('forgot')}>Forgot your password?</Text>
        </>
      )}

      {mode === 'register' && (
        <>
          {emailField}
          {passwordField(true)}
          <Button
            title="Create account"
            disabled={busy || !address || password.length < 8}
            onPress={() => run(async () => { await signUp(address, password); await sendCode(); }, () => go('verify'))}
          />
          <Text style={styles.note}>You will get a 6-digit code by email; entering it verifies the account, and the trial credit follows.</Text>
        </>
      )}

      {mode === 'verify' && (
        <>
          <Text style={styles.title}>Verify your email</Text>
          <Text style={styles.note}>We sent a 6-digit code to {address}</Text>
          {codeField}
          <Button
            title="Verify"
            disabled={busy || otp.length !== 6}
            onPress={() => run(() => verifyEmail(address, otp), () => onSignedIn(address))}
          />
          {resend}
          <Text style={styles.link} onPress={() => onSignedIn(address)}>Later — I am signed in, verify from the account screen</Text>
        </>
      )}

      {mode === 'forgot' && (
        <>
          <Text style={styles.title}>Reset your password</Text>
          {emailField}
          <Button
            title="Send code"
            disabled={busy || !address}
            onPress={() => run(async () => { await requestPasswordReset(address); setResendIn(RESEND_WAIT_S); }, () => go('reset'))}
          />
          <Text style={styles.link} onPress={() => go('signin')}>Back to sign in</Text>
        </>
      )}

      {mode === 'reset' && (
        <>
          <Text style={styles.title}>Reset your password</Text>
          <Text style={styles.note}>We sent a 6-digit code to {address}</Text>
          {codeField}
          {passwordField(true)}
          <Button
            title="Set new password"
            disabled={busy || otp.length !== 6 || password.length < 8}
            onPress={() => run(async () => { await resetPassword(address, otp, password); await signIn(address, password); }, () => onSignedIn(address))}
          />
          <Button
            title={resendIn > 0 ? `Send again (${resendIn} s)` : 'Send again'}
            disabled={busy || resendIn > 0}
            onPress={() => run(async () => { await requestPasswordReset(address); setResendIn(RESEND_WAIT_S); })}
          />
          <Text style={styles.link} onPress={() => go('signin')}>Back to sign in</Text>
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
