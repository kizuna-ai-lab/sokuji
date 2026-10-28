import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react-native';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Field } from '@/components/Field';
import { Notice } from '@/components/Notice';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Spinner } from '@/components/Spinner';
import { cn } from '@/lib/utils';
import { requestPasswordReset, resetPassword, sendVerificationCode, signIn, signUp, verifyEmail } from './client';
import { authErrorKey } from './unwrap';
import { codeLine } from './signInText';
import { createPageGate } from './pageGate';

// 'verifyStart' and 'forgot' are the two code flows' first page: the address and a
// Send code button, and no request until it is pressed.
type Mode = 'signin' | 'register' | 'verifyStart' | 'verify' | 'forgot' | 'reset';

// Sending a code is rate-limited by the backend; the button waits this long
// between sends and says so.
const RESEND_WAIT_S = 60;

export default function SignIn({
  onSignedIn,
  initialMode = 'signin',
  initialEmail = '',
  onBack,
  lockEmail = false,
}: {
  onSignedIn: (email: string) => void;
  /** The account screen opens the code screen for an address whose code was just sent. */
  initialMode?: Mode;
  initialEmail?: string;
  onBack?: () => void;
  /** The account screen's flows: the address is the account's, shown but not editable. */
  lockEmail?: boolean;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  // Which request is running, so the spinner is on the button that started it.
  const [busyFor, setBusyFor] = useState<'primary' | 'resend' | null>(null);
  const busy = busyFor !== null;
  const [error, setError] = useState('');
  const [resendIn, setResendIn] = useState(0);
  // Whether a verification code has gone out in this flow: a new account is on
  // the code page before its first one is sent. Opened on the code page, the
  // caller has sent it.
  const [sent, setSent] = useState(initialMode === 'verify');
  // Whether the password is shown as typed: the phone's usual answer to a mistyped
  // password, instead of typing it twice (owner, 2026-10-28). Hidden again on each page.
  const [showPassword, setShowPassword] = useState(false);
  // A request belongs to the page it was sent from: leave the page (another
  // tab, Back, the screen closes) and its result no longer moves or tells anyone.
  const [gate] = useState(createPageGate);
  useEffect(() => () => gate.leave(), [gate]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  function run(action: () => Promise<unknown>, after?: () => void, which: 'primary' | 'resend' = 'primary') {
    setBusyFor(which);
    setError('');
    void gate.run(action, {
      done: () => after?.(),
      failed: (err) => {
        // A known failure in its own words; anything else in general words, the detail to the log.
        const key = authErrorKey(err);
        if (!key) console.warn(`sign-in: ${err instanceof Error ? err.message : String(err)}`);
        setError(key ? t(key) : t('mobile.common.failed'));
      },
      settled: () => setBusyFor(null),
    });
  }

  const address = email.trim();
  const otp = code.trim();

  function go(next: Mode) {
    // Whatever the last page still has running is dropped (and its spinner with it).
    gate.leave();
    setBusyFor(null);
    setError('');
    setCode('');
    // Only the code page carries over whether its code was sent.
    if (next !== 'verify') setSent(false);
    setShowPassword(false);
    setMode(next);
  }

  const sendCode = () => sendVerificationCode(address);
  const sendReset = () => requestPasswordReset(address);
  // After a send succeeded (on the page that sent it).
  const codeWentOut = () => {
    setSent(true);
    setResendIn(RESEND_WAIT_S);
  };

  const emailField = lockEmail ? (
    <View className="gap-1.5">
      <Text className="text-muted-foreground text-sm">{t('mobile.signIn.email')}</Text>
      <Text>{address}</Text>
    </View>
  ) : (
    <Field
      label={t('mobile.signIn.email')}
      autoCapitalize="none"
      autoComplete="email"
      keyboardType="email-address"
      textContentType="emailAddress"
      // An address is not a word: no corrections and no red underlines (Sophie, iOS).
      autoCorrect={false}
      spellCheck={false}
      // Fixed while a request runs: the page after it names the address the request went to.
      editable={!busy}
      value={email}
      onChangeText={setEmail}
    />
  );
  const passwordField = (newPassword = false) => (
    <Field
      label={newPassword ? t('mobile.signIn.newPassword') : t('mobile.signIn.password')}
      hint={newPassword ? t('mobile.signIn.passwordHint') : undefined}
      secureTextEntry={!showPassword}
      autoComplete={newPassword ? 'new-password' : 'password'}
      // 'password' for a new one too: with 'newPassword', iOS fills an Automatic Strong
      // Password the app never receives (React Native gets no change), so the field could
      // not be edited and Set new password stayed disabled (Sophie, iOS simulator).
      textContentType="password"
      editable={!busy}
      value={password}
      onChangeText={setPassword}
      end={
        <Button
          variant="ghost"
          size="icon"
          accessibilityLabel={showPassword ? t('mobile.signIn.hidePassword') : t('mobile.signIn.showPassword')}
          onPress={() => setShowPassword((v) => !v)}
        >
          <Icon as={showPassword ? EyeOff : Eye} size={22} className="text-muted-foreground" />
        </Button>
      }
    />
  );
  const codeField = (
    <Field
      label={t('mobile.signIn.code')}
      keyboardType="number-pad"
      textContentType="oneTimeCode"
      autoComplete="one-time-code"
      maxLength={6}
      editable={!busy}
      value={code}
      onChangeText={setCode}
    />
  );
  // The one action a page is for: full width, a spinner while its request runs.
  const primary = (title: string, disabled: boolean, onPress: () => void) => (
    <Button size="lg" disabled={busy || disabled} accessibilityState={{ busy: busyFor === 'primary' }} onPress={onPress}>
      {busyFor === 'primary' ? <Spinner /> : null}
      <Text>{title}</Text>
    </Button>
  );
  const link = (title: string, onPress: () => void) => (
    <Button variant="link" className="self-start px-0" onPress={onPress}>
      <Text className="text-left">{title}</Text>
    </Button>
  );
  const resend = (send: () => Promise<unknown>) => (
    <Button variant="outline" disabled={busy || resendIn > 0} accessibilityState={{ busy: busyFor === 'resend' }} onPress={() => run(send, codeWentOut, 'resend')}>
      {busyFor === 'resend' ? <Spinner /> : null}
      <Text>{resendIn > 0 ? t('mobile.signIn.sendAgainIn', { seconds: resendIn }) : t('mobile.signIn.sendAgain')}</Text>
    </Button>
  );
  // Opened from the account screen, a page has the app's header; on its own, a title and a link back to sign in.
  const back = onBack ?? (() => go('signin'));
  const pageTitle = (title: string) => (onBack ? null : <Text role="heading" className="text-2xl font-semibold">{title}</Text>);
  const backLink = onBack ? null : link(t('mobile.signIn.back'), back);
  const headerTitle = mode === 'verify' || mode === 'verifyStart' ? t('mobile.signIn.verifyTitle') : t('mobile.signIn.resetTitle');
  const errorLine = error ? <Notice tone="error">{error}</Notice> : null;

  return (
    <KeyboardAvoidingView className="bg-background w-full flex-1" behavior="padding">
      {onBack ? <ScreenHeader title={headerTitle} onBack={onBack} /> : null}
      <ScrollView className="flex-1" contentContainerClassName="gap-4 px-6 pb-10 pt-4" keyboardShouldPersistTaps="handled">
        {(mode === 'signin' || mode === 'register') && (
          <>
            <Text role="heading" className="text-3xl font-semibold">Sokuji</Text>
            <View role="tablist" className="bg-muted flex-row gap-1 rounded-lg p-1">
              {(['signin', 'register'] as const).map((m) => (
                <Button
                  key={m}
                  role="tab"
                  accessibilityState={{ selected: mode === m }}
                  variant={mode === m ? 'outline' : 'ghost'}
                  className={cn('flex-1 px-2', mode !== m && 'border border-transparent')}
                  onPress={() => go(m)}
                >
                  <Text className={cn(mode !== m && 'text-muted-foreground')}>{m === 'signin' ? t('mobile.signIn.title') : t('mobile.signIn.register')}</Text>
                </Button>
              ))}
            </View>
          </>
        )}

        {mode === 'signin' && (
          <>
            {emailField}
            {passwordField()}
            {errorLine}
            {primary(t('mobile.signIn.submit'), !address || !password, () => run(() => signIn(address, password), () => onSignedIn(address)))}
            {link(t('mobile.signIn.forgot'), () => go('forgot'))}
          </>
        )}

        {mode === 'register' && (
          <>
            {emailField}
            {passwordField(true)}
            {errorLine}
            {primary(t('mobile.signIn.register'), !address || password.length < 8, () => run(
              () => signUp(address, password),
              () => {
                // The account exists once sign-up returns: the code page from here on, which
                // sends the first code itself and says whether it went out (it has Send again).
                go('verify');
                run(sendCode, codeWentOut, 'resend');
              },
            ))}
            <Text className="text-muted-foreground text-sm">{t('mobile.signIn.registerNote')}</Text>
          </>
        )}

        {mode === 'verify' && (
          <>
            {pageTitle(t('mobile.signIn.verifyTitle'))}
            <Text className="text-muted-foreground">{codeLine(t, { email: address, sent, sending: busyFor === 'resend' })}</Text>
            {codeField}
            {errorLine}
            {primary(t('mobile.signIn.verify'), otp.length !== 6, () => run(() => verifyEmail(address, otp), () => onSignedIn(address)))}
            {resend(sendCode)}
            {onBack ? null : link(t('mobile.signIn.later'), () => onSignedIn(address))}
          </>
        )}

        {mode === 'verifyStart' && (
          <>
            {pageTitle(t('mobile.signIn.verifyTitle'))}
            <Text className="text-muted-foreground">{t('mobile.signIn.willSendCode', { email: address })}</Text>
            {!lockEmail && emailField}
            {errorLine}
            {primary(t('mobile.signIn.sendCode'), !address, () => run(sendCode, () => { codeWentOut(); go('verify'); }))}
            {backLink}
          </>
        )}

        {mode === 'forgot' && (
          <>
            {pageTitle(t('mobile.signIn.resetTitle'))}
            {lockEmail && <Text className="text-muted-foreground">{t('mobile.signIn.willSendCode', { email: address })}</Text>}
            {!lockEmail && emailField}
            {errorLine}
            {primary(t('mobile.signIn.sendCode'), !address, () => run(sendReset, () => { codeWentOut(); go('reset'); }))}
            {backLink}
          </>
        )}

        {mode === 'reset' && (
          <>
            {pageTitle(t('mobile.signIn.resetTitle'))}
            <Text className="text-muted-foreground">{t('mobile.signIn.codeSent', { email: address })}</Text>
            {codeField}
            {passwordField(true)}
            {errorLine}
            {primary(t('mobile.signIn.setNewPassword'), otp.length !== 6 || password.length < 8, () => run(async () => { await resetPassword(address, otp, password); await signIn(address, password); }, () => onSignedIn(address)))}
            {resend(sendReset)}
            {backLink}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
