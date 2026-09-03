import { it, expect } from 'vitest';
import { reconcileTtsVoice } from './nativeTtsVoiceReconciliation';
const ava = [{ name: 'Ava', language: 'en', curated: true, unstable: false, default: true }];

it('non-cloning models pass through (no builtin default)', () => {
  expect(reconcileTtsVoice('', [], 'en', [], false)).toBe('');
  expect(reconcileTtsVoice('sid:3', [], 'en', [], false)).toBe('sid:3');
});
it('cloning models default empty/dead-custom to the language default', () => {
  expect(reconcileTtsVoice('', [], 'en', ava, true)).toBe('builtin:Ava');
  expect(reconcileTtsVoice('custom:9', [], 'en', ava, true)).toBe('builtin:Ava');
  expect(reconcileTtsVoice('custom:9', [9], 'en', ava, true)).toBe('custom:9');
});
it('drops a missing custom id for any custom-capable model', () => {
  const voices = [{ name: 'Robert', default: true } as any];
  expect(reconcileTtsVoice('custom:99', [3], 'en', voices, true)).toBe('builtin:Robert');
  expect(reconcileTtsVoice('custom:3', [3], 'en', voices, true)).toBe('custom:3');
});
it('passes through when the model has no custom voices', () => {
  expect(reconcileTtsVoice('builtin:X', [], 'en', [], false)).toBe('builtin:X');
});
it('drops a stale builtin name from a previously selected model', () => {
  // regression: pocket's persisted 'builtin:eponine' reached gpt-sovits and
  // killed TTS for the session (voices/eponine.wav → System error)
  expect(reconcileTtsVoice('builtin:eponine', [], 'zh', ava, true)).toBe('builtin:Ava');
  expect(reconcileTtsVoice('builtin:Ava', [], 'en', ava, true)).toBe('builtin:Ava');
});
it('cannot validate builtin names against an empty voice list (pass through)', () => {
  // "not loaded": the family DOES have built-ins, this call just has no list.
  expect(reconcileTtsVoice('builtin:Style1', [], 'en', [], true)).toBe('builtin:Style1');
});
// A family that exposes no built-in voices at all is the other reading of an
// empty list, and the caller can tell them apart (capability builtin:'none').
// Applying a leftover preset name there means setVoice() against an empty
// preset list, which fails and takes TTS down for the session — the exact
// shape of the pocket→gpt-sovits regression above, reachable today by
// switching from supertonic to any clone-only family.
it('drops a stale builtin name when the family has no built-in voices at all', () => {
  expect(reconcileTtsVoice('builtin:M1', [7, 8], 'en', [], true, false)).toBe('custom:7');
  // Nothing to fall back TO: the bare default ('') is right for the families
  // that synthesise with no voice set (irodori_tts, voxcpm1, voxcpm2).
  expect(reconcileTtsVoice('builtin:M1', [], 'ja', [], true, false)).toBe('');
});
// R35: a clone-only family (no builtin voices at all) has no builtin default
// to fall back to — landing on '' would silently strand a model the caller's
// pre-init gate already confirmed CAN speak (it found an eligible clip).
it('R35: a clone-only family (no builtin voices) falls back to the first eligible custom clip, not empty', () => {
  expect(reconcileTtsVoice('custom:99', [7, 8], 'en', [], true)).toBe('custom:7');
  expect(reconcileTtsVoice('', [7, 8], 'en', [], true)).toBe('custom:7');
  // No eligible clip at all (caller's gate would have disabled TTS before
  // reaching here in practice) — still degrades to '' rather than throwing.
  expect(reconcileTtsVoice('custom:99', [], 'en', [], true)).toBe('');
});
