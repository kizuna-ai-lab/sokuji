import { describe, expect, it } from 'vitest';
import {
  PRESET_VOICE_ORDER,
  presetSidForVoiceCode,
  voiceCodeForPresetSid,
  importedSidFromDbKey,
  dbKeyFromImportedSid,
  isPresetSid,
  isImportedSid,
} from './sidMapping';

describe('sidMapping', () => {
  it('PRESET_VOICE_ORDER has 10 codes in the expected order', () => {
    expect(PRESET_VOICE_ORDER).toEqual(['F1','F2','F3','F4','F5','M1','M2','M3','M4','M5']);
  });

  it('presetSidForVoiceCode maps codes to fixed sids', () => {
    expect(presetSidForVoiceCode('F1')).toBe(0);
    expect(presetSidForVoiceCode('M3')).toBe(7);
    expect(presetSidForVoiceCode('M5')).toBe(9);
  });

  it('voiceCodeForPresetSid is the inverse of presetSidForVoiceCode', () => {
    expect(voiceCodeForPresetSid(0)).toBe('F1');
    expect(voiceCodeForPresetSid(7)).toBe('M3');
    expect(voiceCodeForPresetSid(9)).toBe('M5');
  });

  it('voiceCodeForPresetSid returns null for non-preset sids', () => {
    expect(voiceCodeForPresetSid(10)).toBeNull();
    expect(voiceCodeForPresetSid(-1)).toBeNull();
    expect(voiceCodeForPresetSid(99)).toBeNull();
  });

  it('importedSidFromDbKey adds the +10 offset', () => {
    expect(importedSidFromDbKey(1)).toBe(11);
    expect(importedSidFromDbKey(42)).toBe(52);
  });

  it('dbKeyFromImportedSid subtracts the +10 offset', () => {
    expect(dbKeyFromImportedSid(11)).toBe(1);
    expect(dbKeyFromImportedSid(52)).toBe(42);
  });

  it('dbKeyFromImportedSid returns null for non-imported sids', () => {
    expect(dbKeyFromImportedSid(7)).toBeNull();
    expect(dbKeyFromImportedSid(9)).toBeNull();
    expect(dbKeyFromImportedSid(-1)).toBeNull();
  });

  it('isPresetSid classifies sids correctly', () => {
    expect(isPresetSid(0)).toBe(true);
    expect(isPresetSid(9)).toBe(true);
    expect(isPresetSid(10)).toBe(false);
    expect(isPresetSid(-1)).toBe(false);
  });

  it('isImportedSid classifies sids correctly', () => {
    expect(isImportedSid(10)).toBe(true);
    expect(isImportedSid(99)).toBe(true);
    expect(isImportedSid(9)).toBe(false);
    expect(isImportedSid(-1)).toBe(false);
  });
});
