import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { accountEmail, sessionToken, signOut } from './src/auth/client';
import { signOutAndForget } from './src/auth/signOutFlow';
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
    // The app draws edge to edge: the status bar, a camera cutout and the
    // gesture bar overlap the window. The insets come from the native module;
    // React Native's own SafeAreaView only knows iOS.
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.content}>
          {(!ready || token === undefined) && <ActivityIndicator style={styles.loading} />}
          {ready && token === null && <SignIn onSignedIn={refresh} />}
          {ready && !!token && (
            <Main
              token={token}
              email={email}
              onSignOut={() => signOutAndForget({ signOut, forget: refresh, log: console.log })}
              onAccountDeleted={refresh}
              // A request that was already in flight when the account changed must not sign the new one out.
              onSignInRequired={() => setToken((current) => (current === token ? null : current))}
            />
          )}
        </View>
        {/* Dark icons on the app's light background. "auto" follows the system scheme, so a
            phone in dark mode drew white time and icons over our white bar; this follows the
            app's own scheme once it has a dark palette. */}
        <StatusBar style="dark" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  loading: { marginTop: 120 },
});
