/**
 * The Soniox real-time model this app transcribes with. On its own, with no
 * imports, because the mobile app shares it: `config.ts` builds the desktop's
 * session config from the desktop's settings and reaches the log store (and
 * React) on the way, which a phone bundle must not carry.
 */
export const SONIOX_STT_MODEL = 'stt-rt-v5';
