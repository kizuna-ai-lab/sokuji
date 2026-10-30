// The production backend (spec R7). Kept apart from auth.ts so the node-only
// unit tests can import lease.ts without pulling in expo-secure-store.
export const BACKEND_URL = 'https://sokuji.kizuna.ai';

// React Native's fetch has no timeout of its own: the app's requests to the
// backend (account/http.ts, the auth client) give up after this.
export const REQUEST_TIMEOUT_MS = 15000;
