import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { accountEmail, sessionToken, signOut } from './src/auth/client';
import { settingsStore } from './src/store/useSettings';
import { applyAppearance } from './src/screens/Settings';
import SignIn from './src/auth/SignIn';
import Main from './src/screens/Main';
import { initI18n } from './src/i18n';

export default function App() {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState('');

  async function refresh() {
    try {
      const token = await sessionToken();
      setEmail(token ? (await accountEmail()) ?? '' : '');
      setToken(token);
    } catch {
      setToken(null);
    }
  }

  useEffect(() => {
    initI18n().finally(() => setReady(true));
    refresh();
    // The appearance setting is an override of the system's: applied as stored, and on change.
    applyAppearance(settingsStore.getState().settings.appearance);
    return settingsStore.subscribe((s, prev) => {
      if (s.settings.appearance !== prev.settings.appearance) applyAppearance(s.settings.appearance);
    });
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {(!ready || token === undefined) && <Text>…</Text>}
        {ready && token === null && <SignIn onSignedIn={refresh} />}
        {ready && !!token && <Main token={token} email={email} onSignOut={async () => { await signOut(); await refresh(); }} onAccountDeleted={refresh} />}
      </View>
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { flex: 1, alignItems: 'center', paddingVertical: 12 },
});
