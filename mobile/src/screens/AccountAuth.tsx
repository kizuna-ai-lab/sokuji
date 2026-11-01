import { useCallback, useEffect, useState } from 'react';
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import SignIn from '../auth/SignIn';
import { Screen } from '@/components/ScreenHeader';
import { leaveState } from '@/lib/leave';
import { useApp } from '../navigation/context';
import type { AppNavigation } from '../navigation/routes';

// The account's own sign-in flows, each its own screen under the system bar:
// verify the address, or set / change the password (owner, 2026-10-28). The
// page is left by the bar's Back, held while the page's own request runs: the
// bar's button and the swipe go, and Android's Back is refused (OCR).
function AuthRoute({ mode }: { mode: 'verifyStart' | 'forgot' }) {
  const { email } = useApp();
  const navigation = useNavigation<AppNavigation>();
  const [holding, setHolding] = useState(false);
  // Signed in or verified: the page leaves once its request has released the
  // hold (the result arrives before the hold does; a Back sent during the hold
  // would be refused and lost).
  const [leaving, setLeaving] = useState(false);
  const { prevent, goBack } = leaveState({ holding, leaving });
  usePreventRemove(prevent, () => {});
  useEffect(() => {
    navigation.setOptions({ headerBackVisible: !prevent, gestureEnabled: !prevent });
  }, [navigation, prevent]);
  useEffect(() => {
    if (goBack) navigation.goBack();
  }, [goBack, navigation]);
  const onHoldingChange = useCallback((next: boolean) => setHolding(next), []);
  return (
    <Screen scroll={false}>
      <SignIn initialMode={mode} initialEmail={email} lockEmail embedded onSignedIn={() => setLeaving(true)} onHoldingChange={onHoldingChange} />
    </Screen>
  );
}

export function VerifyScreen() {
  return <AuthRoute mode="verifyStart" />;
}

export function PasswordScreen() {
  return <AuthRoute mode="forgot" />;
}
