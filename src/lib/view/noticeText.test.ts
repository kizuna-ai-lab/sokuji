import { describe, it, expect } from 'vitest';
import type { TFunction } from 'i18next';
import en from '../../locales/en/translation.json';
import { APP_CAPTURE_LOST, APP_MONITOR_MISSING } from '../audio/capture/systemAudio';
import { CLIENT_DIAGNOSTICS } from '../diagnostics/clientDiagnostics';
import { RUN_NOTICE_CODES } from '../session/codes';
import { NOTICE_WORDS, noticeText } from './noticeText';

/** A stand-in for i18next: fills `{{name}}` from the options. */
const t = ((key: string, options: Record<string, unknown>) =>
  `${key}|${String(options.defaultValue).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name]))}`) as unknown as TFunction;

describe('noticeText', () => {
  it("looks a known code up, with the notice's own message as its detail", () => {
    expect(noticeText(t, { code: 'leg_failed', message: 'Invalid API key' })).toBe('notices.leg_failed|The session stopped: Invalid API key');
  });

  it('passes the params through', () => {
    const words = noticeText(((key: string, options: Record<string, unknown>) => `${key}:${String(options.minutes)}`) as unknown as TFunction, { code: 'source_ended', message: 'x', params: { minutes: 3 } });
    expect(words).toBe('notices.source_ended:3');
  });

  it('shows the message itself for a code it has no words for, or no code', () => {
    expect(noticeText(t, { code: 'fake_build_refused', message: 'The fake refuses to build (fault knob).' })).toBe('The fake refuses to build (fault knob).');
    expect(noticeText(t, { message: 'plain' })).toBe('plain');
  });

  it('has words for every code the runner, the capture and the adapters record', () => {
    for (const code of [...RUN_NOTICE_CODES, ...Object.keys(CLIENT_DIAGNOSTICS), APP_CAPTURE_LOST, APP_MONITOR_MISSING]) {
      expect(NOTICE_WORDS[code], code).toBeDefined();
    }
  });

  it('matches the English locale word for word', () => {
    expect((en as unknown as { notices: Record<string, string> }).notices).toEqual(NOTICE_WORDS);
  });
});
