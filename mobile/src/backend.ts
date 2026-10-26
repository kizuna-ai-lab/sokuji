// The production backend (spec R7). Kept apart from auth.ts so the node-only
// unit tests can import lease.ts without pulling in expo-secure-store.
export const BACKEND_URL = 'https://sokuji.kizuna.ai';
