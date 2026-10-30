import './global.css';
import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from 'react-native-safe-area-context';
import { PortalHost } from '@rn-primitives/portal';
import { useColorScheme } from 'nativewind';
import { Spinner } from './src/components/Spinner';
import { currentAccount, signOut } from './src/auth/client';
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
  const [account, setAccount] = useState('');
  // The scheme the app is drawn in: the appearance setting, or the system's.
  const { colorScheme } = useColorScheme();

  async function refresh() {
    try {
      // One session read: a token without an account id counts as signed out.
      const current = await currentAccount();
      setEmail(current?.email ?? '');
      setAccount(current?.id ?? '');
      setToken(current?.token ?? null);
    } catch {
      setToken(null);
    }
  }

  useEffect(() => {
    initI18n().catch((err) => console.error('i18n init failed', err)).finally(() => setReady(true));
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
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <SafeAreaView className="bg-background flex-1" edges={['top', 'bottom', 'left', 'right']}>
        <View className="flex-1 items-center py-3">
          {(!ready || token === undefined) && <Spinner size="large" className="mt-32" />}
          {ready && token === null && <SignIn onSignedIn={refresh} />}
          {ready && !!token && (
            <Main
              // Another account is another Main: nothing of the last one's (its history) carries over.
              key={account}
              accountId={account}
              token={token}
              email={email}
              onSignOut={() => signOutAndForget({ signOut, forget: refresh, log: console.log })}
              onAccountDeleted={refresh}
              // A request that was already in flight when the account changed must not sign the new one out.
              onSignInRequired={() => setToken((current) => (current === token ? null : current))}
            />
          )}
        </View>
        {/* The bar's time and icons in the app's own scheme, not the system's: with the
            appearance set to Light on a phone in dark mode, "auto" drew white icons over our
            white bar. */}
        <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      </SafeAreaView>
      {/* Where menus, dialogs and alerts render: above every screen, outside the safe-area padding. */}
      <PortalHost />
    </SafeAreaProvider>
  );
}
