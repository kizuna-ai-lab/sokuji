import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Button, SafeAreaView, ScrollView, StyleSheet, Text } from 'react-native';
import { sessionToken, signOut } from './src/auth';
import SignIn from './src/SignIn';
import MicProbe from './src/MicProbe';

export default function App() {
  const [token, setToken] = useState<string | null | undefined>(undefined);

  async function refresh() {
    try {
      setToken(await sessionToken());
    } catch {
      setToken(null);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {token === undefined && <Text>Loading…</Text>}
        {token === null && <SignIn onSignedIn={refresh} />}
        {!!token && (
          <>
            <Text>signed in</Text>
            <Button title="Sign out" onPress={async () => { await signOut(); await refresh(); }} />
          </>
        )}
        <MicProbe />
      </ScrollView>
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { alignItems: 'center', paddingVertical: 24 },
});
