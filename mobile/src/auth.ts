import * as SecureStore from 'expo-secure-store';
import { createAuthClient } from 'better-auth/react';
import { emailOTPClient } from 'better-auth/client/plugins';
import { expoClient } from '@better-auth/expo/client';
import { BACKEND_URL } from './backend';

export { BACKEND_URL };

export const authClient = createAuthClient({
  baseURL: BACKEND_URL,
  plugins: [
    emailOTPClient(),
    expoClient({ scheme: 'sokuji', storagePrefix: 'sokuji', storage: SecureStore }),
  ],
});

function fail(error: { message?: string; status?: number } | null | undefined): never {
  throw new Error(error?.message || `request failed${error?.status ? ` (${error.status})` : ''}`);
}

export async function sendCode(email: string): Promise<void> {
  const result = await authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' });
  if (result.error) fail(result.error);
}

export async function signInWithCode(email: string, otp: string): Promise<void> {
  const result = await authClient.signIn.emailOtp({ email, otp });
  if (result.error) fail(result.error);
}

// Prototype only: spares the tester a code email per install. The backend already
// serves password sign-in for the desktop; the MVP keeps one-time code only (R11).
export async function signInWithPassword(email: string, password: string): Promise<void> {
  const result = await authClient.signIn.email({ email, password });
  if (result.error) fail(result.error);
}

export async function sessionToken(): Promise<string | null> {
  const result = await authClient.getSession();
  return result.data?.session.token ?? null;
}

export async function signOut(): Promise<void> {
  await authClient.signOut();
}
