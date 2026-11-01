import { useMemo } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useColorScheme } from 'nativewind';
import { createHistoryStore } from '../history/store';
import { documentFs } from '../history/fs';
import Main from '../screens/Main';
import Settings from '../screens/Settings';
import Account from '../screens/Account';
import History from '../screens/History';
import Listen from '../screens/Listen';
import Devices from '../screens/Devices';
import Usage from '../screens/Usage';
import ReaderScreen from '../screens/ReaderScreen';
import { PasswordScreen, VerifyScreen } from '../screens/AccountAuth';
import { AppContext, type AppContextValue } from './context';
import type { RootStackParamList } from './routes';
import { navigationTheme } from './theme';

const Stack = createNativeStackNavigator<RootStackParamList>();

// The system's own navigation bar on every screen but the main one (owner,
// 2026-11-01): iOS draws its chevron, Android its arrow, each with the
// platform's title and sizes; the main screen keeps its own one-line bar.
const screenOptions: NativeStackNavigationOptions = {
  // The chevron alone, no "Back" or previous title beside it.
  headerBackButtonDisplayMode: 'minimal',
  // Its long-press menu would list the screens by their route names.
  headerBackButtonMenuEnabled: false,
};

/** The signed-in app: its screens on a native stack, sharing the account and its history. */
export function AppNavigator({ token, email, accountId, onSignOut, onAccountDeleted, onSignInRequired }: Omit<AppContextValue, 'history'>) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  // This account's sessions only (owner, 2026-10-28: history is kept per account).
  const history = useMemo(() => createHistoryStore(documentFs, accountId), [accountId]);
  const value = useMemo<AppContextValue>(
    () => ({ token, email, accountId, history, onSignOut, onAccountDeleted, onSignInRequired }),
    [token, email, accountId, history, onSignOut, onAccountDeleted, onSignInRequired],
  );
  return (
    <AppContext.Provider value={value}>
      <NavigationContainer theme={navigationTheme(colorScheme)}>
        <Stack.Navigator initialRouteName="Main" screenOptions={screenOptions}>
          <Stack.Screen name="Main" component={Main} options={{ headerShown: false, title: 'Sokuji' }} />
          <Stack.Screen name="Settings" component={Settings} options={{ title: t('mobile.menu.settings') }} />
          <Stack.Screen name="Account" component={Account} options={{ title: t('mobile.menu.account') }} />
          <Stack.Screen name="History" component={History} options={{ title: t('mobile.history.title') }} />
          <Stack.Screen name="Listen" component={Listen} options={{ title: t('mobile.settings.listen') }} />
          <Stack.Screen name="Devices" component={Devices} options={{ title: t('mobile.settings.devices') }} />
          <Stack.Screen name="Usage" component={Usage} options={{ title: t('mobile.account.usage') }} />
          {/* The session's name and date scroll with its text (at AX5 they filled a fixed header). */}
          <Stack.Screen name="Reader" component={ReaderScreen} options={{ title: '' }} />
          <Stack.Screen name="Verify" component={VerifyScreen} options={{ title: t('mobile.signIn.verifyTitle') }} />
          <Stack.Screen name="Password" component={PasswordScreen} options={{ title: t('mobile.signIn.resetTitle') }} />
        </Stack.Navigator>
      </NavigationContainer>
    </AppContext.Provider>
  );
}
