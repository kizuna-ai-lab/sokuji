import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, ScrollView, StyleSheet, Text } from 'react-native';
import { sessionToken, signOut } from './src/auth/client';
import SignIn from './src/auth/SignIn';
import Main from './src/screens/Main';
import { initI18n } from './src/i18n';

export default function App() {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [ready, setReady] = useState(false);

  async function refresh() {
    try {
      setToken(await sessionToken());
    } catch {
      setToken(null);
    }
  }

  useEffect(() => {
    initI18n().finally(() => setReady(true));
    refresh();
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {(!ready || token === undefined) && <Text>…</Text>}
        {ready && token === null && <SignIn onSignedIn={refresh} />}
        {ready && !!token && <Main token={token} onSignOut={async () => { await signOut(); await refresh(); }} />}
      </ScrollView>
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { alignItems: 'center', paddingVertical: 24 },
});
