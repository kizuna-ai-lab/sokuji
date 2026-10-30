import * as SecureStore from 'expo-secure-store';
import { createAuthClient } from 'better-auth/react';
import { emailOTPClient } from 'better-auth/client/plugins';
import { expoClient } from '@better-auth/expo/client';
import { BACKEND_URL } from '../backend';
import { localPart, unwrap } from './unwrap';

export { BACKEND_URL };

// A request that stalls fails after this, as the app's other requests do
// (account/http.ts): a sign-in page holds its tabs and Back while one runs.
const AUTH_TIMEOUT_MS = 15000;

export const authClient = createAuthClient({
  baseURL: BACKEND_URL,
  fetchOptions: { timeout: AUTH_TIMEOUT_MS },
  plugins: [
    emailOTPClient(),
    expoClient({ scheme: 'sokuji', storagePrefix: 'sokuji', storage: SecureStore }),
  ],
});

// Accounts are email + password, as the desktop (R11). Sign-up is verified by a
// 6-digit code the app asks for itself; the backend sends the app no link mail.
// Every call is one better-auth request; an error becomes a thrown Error.

export async function signUp(email: string, password: string): Promise<void> {
  unwrap(await authClient.signUp.email({ email, password, name: localPart(email) }));
}

export async function sendVerificationCode(email: string): Promise<void> {
  unwrap(await authClient.emailOtp.sendVerificationOtp({ email, type: 'email-verification' }), { sendsCode: true });
}

export async function verifyEmail(email: string, otp: string): Promise<void> {
  unwrap(await authClient.emailOtp.verifyEmail({ email, otp }));
}

export async function signIn(email: string, password: string): Promise<void> {
  unwrap(await authClient.signIn.email({ email, password }));
}

export async function requestPasswordReset(email: string): Promise<void> {
  unwrap(await authClient.emailOtp.sendVerificationOtp({ email, type: 'forget-password' }), { sendsCode: true });
}

export async function resetPassword(email: string, otp: string, password: string): Promise<void> {
  unwrap(await authClient.emailOtp.resetPassword({ email, otp, password }));
}

export async function deleteAccount(): Promise<void> {
  unwrap(await authClient.deleteUser({}));
}

export async function emailVerified(): Promise<boolean> {
  const data = unwrap(await authClient.getSession());
  return data?.user?.emailVerified ?? false;
}

/**
 * The signed-in account in one session read: its token, its user id (what the
 * history on this phone is kept under) and its email. Null when signed out, or
 * when the session lacks either (no history may be kept under no account).
 */
export async function currentAccount(): Promise<{ token: string; id: string; email: string } | null> {
  const data = unwrap(await authClient.getSession());
  // A 200 with no session is what an expired or revoked session answers.
  const token = data?.session?.token;
  const id = data?.user?.id;
  return token && id ? { token, id, email: data?.user?.email ?? '' } : null;
}

export async function signOut(): Promise<void> {
  unwrap(await authClient.signOut());
}
