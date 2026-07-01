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
