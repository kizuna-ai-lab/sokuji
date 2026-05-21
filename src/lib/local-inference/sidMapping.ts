/**
 * sid (speaker id) numbering for the Supertonic 3 TTS engine.
 *
 * Sids 0–9 map to the 10 official preset voices in a fixed order. Sids ≥ 10
 * map to user-imported voices whose IndexedDB primary key is (sid - 10).
 *
 * The +10 offset keeps preset sids stable across releases and prevents
 * imported voice sids from being recycled when the user deletes one (the
 * IndexedDB autoincrement counter never reuses keys).
 */

/** Voice code → sid order. Index in this array IS the preset sid. */
export const PRESET_VOICE_ORDER = [
  'F1', 'F2', 'F3', 'F4', 'F5',
  'M1', 'M2', 'M3', 'M4', 'M5',
] as const;

export type PresetVoiceCode = (typeof PRESET_VOICE_ORDER)[number];

const PRESET_COUNT = PRESET_VOICE_ORDER.length;
const IMPORTED_SID_OFFSET = 10;

export function presetSidForVoiceCode(code: PresetVoiceCode): number {
  return PRESET_VOICE_ORDER.indexOf(code);
}

export function voiceCodeForPresetSid(sid: number): PresetVoiceCode | null {
  if (sid < 0 || sid >= PRESET_COUNT) return null;
  return PRESET_VOICE_ORDER[sid];
}

export function importedSidFromDbKey(dbKey: number): number {
  return dbKey + IMPORTED_SID_OFFSET;
}

export function dbKeyFromImportedSid(sid: number): number | null {
  if (sid < IMPORTED_SID_OFFSET) return null;
  return sid - IMPORTED_SID_OFFSET;
}

export function isPresetSid(sid: number): boolean {
  return sid >= 0 && sid < PRESET_COUNT;
}

export function isImportedSid(sid: number): boolean {
  return sid >= IMPORTED_SID_OFFSET;
}
