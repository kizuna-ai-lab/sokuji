import { useEffect, useState } from 'react';
import { Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { sendCode, signInWithCode, signInWithPassword } from './auth';

export default function SignIn({ onSignedIn }: { onSignedIn: (email: string) => void }) {
  // Prototype only: a tester's address from the local Metro environment, so it is not typed through an IME.
  const [email, setEmail] = useState(process.env.EXPO_PUBLIC_TEST_EMAIL ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Unattended test builds only: both values come from the local build environment.
  useEffect(() => {
    const pw = process.env.EXPO_PUBLIC_TEST_PASSWORD;
    if (pw && email) void run(() => signInWithPassword(email.trim(), pw), () => onSignedIn(email.trim()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const trimmed = email.trim();
  return (
    <View style={styles.box}>
      <Text style={styles.title}>Sign in to Kizuna AI</Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <Button title="Send code" disabled={busy || !trimmed} onPress={() => run(() => sendCode(trimmed), () => setCodeSent(true))} />
      {codeSent && (
        <>
          <TextInput
            style={styles.input}
            placeholder="6-digit code"
            keyboardType="number-pad"
            value={code}
            onChangeText={setCode}
          />
          <Button
            title="Sign in"
            disabled={busy || !code.trim()}
            onPress={() => run(() => signInWithCode(trimmed, code.trim()), () => onSignedIn(trimmed))}
          />
        </>
      )}
      <View style={styles.divider} />
      <Text style={styles.note}>Prototype only</Text>
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <Button
        title="Sign in with password"
        disabled={busy || !trimmed || !password}
        onPress={() => run(() => signInWithPassword(trimmed, password), () => onSignedIn(trimmed))}
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { padding: 24, gap: 12, width: '100%' },
  title: { fontSize: 20, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 10, fontSize: 16 },
  divider: { height: 1, backgroundColor: '#ddd', marginVertical: 8 },
  note: { fontSize: 12, color: '#888' },
  error: { color: '#c0392b' },
});
