type T = (key: string, values?: Record<string, string>) => string;

/**
 * The line above the code field. A new account reaches the code page before
 * its first code is sent (the account exists by then), so the page must not
 * say "we sent a code" until one has gone out, and must say so when the
 * send failed. A resend after a code went out keeps "sent": that code works.
 */
export function codeLine(t: T, state: { email: string; sent: boolean; sending: boolean }): string {
  if (state.sent) return t('mobile.signIn.codeSent', { email: state.email });
  if (state.sending) return t('mobile.signIn.sendingCode', { email: state.email });
  return t('mobile.signIn.codeNotSent', { email: state.email });
}
