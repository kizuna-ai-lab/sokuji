import { reconcileTtsVoice } from './nativeTtsVoiceReconciliation';

it('empty resolves to the per-language default', () => {
  expect(reconcileTtsVoice('', [], 'en')).toBe('builtin:Ava');
});
it('valid custom passes through', () => {
  expect(reconcileTtsVoice('custom:3', [3, 5], 'en')).toBe('custom:3');
});
it('deleted custom falls back to default', () => {
  expect(reconcileTtsVoice('custom:9', [3, 5], 'en')).toBe('builtin:Ava');
});
it('builtin passes through', () => {
  expect(reconcileTtsVoice('builtin:Bella', [], 'en')).toBe('builtin:Bella');
});
