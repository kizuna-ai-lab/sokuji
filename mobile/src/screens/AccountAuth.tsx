import { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import SignIn from '../auth/SignIn';
import { Screen } from '@/components/ScreenHeader';
import { useApp } from '../navigation/context';
import type { AppNavigation } from '../navigation/routes';

// The account's own sign-in flows, each its own screen under the system bar:
// verify the address, or set / change the password (owner, 2026-10-28). The
// page is left by the bar's Back, held while the page's own request runs.
function AuthRoute({ mode }: { mode: 'verifyStart' | 'forgot' }) {
  const { email } = useApp();
  const navigation = useNavigation<AppNavigation>();
  const onHoldingChange = useCallback(
    (holding: boolean) => navigation.setOptions({ headerBackVisible: !holding, gestureEnabled: !holding }),
    [navigation],
  );
  return (
    <Screen scroll={false}>
      <SignIn initialMode={mode} initialEmail={email} lockEmail embedded onSignedIn={() => navigation.goBack()} onHoldingChange={onHoldingChange} />
    </Screen>
  );
}

export function VerifyScreen() {
  return <AuthRoute mode="verifyStart" />;
}

export function PasswordScreen() {
  return <AuthRoute mode="forgot" />;
}
