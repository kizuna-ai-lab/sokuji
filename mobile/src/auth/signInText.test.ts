import { describe, expect, it } from 'vitest';
import { codeLine } from './signInText';

const t = (key: string, values?: Record<string, string>) => `${key}(${values?.email ?? ''})`;

describe('what the code page says about the email', () => {
  it('says the code is on its way only once it has been sent', () => {
    expect(codeLine(t, { email: 'a@b.c', sent: true, sending: false })).toBe('mobile.signIn.codeSent(a@b.c)');
  });

  it('says it is sending while the first send runs', () => {
    expect(codeLine(t, { email: 'a@b.c', sent: false, sending: true })).toBe('mobile.signIn.sendingCode(a@b.c)');
  });

  it('says no code went out when the first send failed, and how to retry', () => {
    expect(codeLine(t, { email: 'a@b.c', sent: false, sending: false })).toBe('mobile.signIn.codeNotSent(a@b.c)');
  });

  it('keeps "sent" while a resend runs: the earlier code still works', () => {
    expect(codeLine(t, { email: 'a@b.c', sent: true, sending: true })).toBe('mobile.signIn.codeSent(a@b.c)');
  });
});
