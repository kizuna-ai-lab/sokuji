import { describe, it, expect } from 'vitest';
import type { TFunction } from 'i18next';
import en from '../../locales/en/translation.json';
import { APP_CAPTURE_LOST, APP_MONITOR_MISSING, SILENT_NO_PERMISSION } from '../audio/capture/systemAudio';
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

  it('puts the five API error types into words', () => {
    for (const code of ['auth', 'rate_limit', 'network', 'server', 'client']) {
      expect(NOTICE_WORDS[code]).toBeDefined();
      expect(noticeText(t, { code, message: 'HTTP 401' })).toContain('HTTP 401');
    }
  });

  it('has words for every code the runner, the capture and the adapters record', () => {
    for (const code of [...RUN_NOTICE_CODES, ...Object.keys(CLIENT_DIAGNOSTICS), APP_CAPTURE_LOST, APP_MONITOR_MISSING, SILENT_NO_PERMISSION]) {
      expect(NOTICE_WORDS[code], code).toBeDefined();
    }
  });

  it("puts the local engines' notices into words", () => {
    for (const code of ['no_asr', 'memory_exceeded', 'gpu_out_of_memory', 'transcription_failed', 'translation_failed', 'translation_unavailable']) {
      expect(NOTICE_WORDS[code]).toBeDefined();
    }
  });

  it('matches the English locale word for word', () => {
    expect((en as unknown as { notices: Record<string, string> }).notices).toEqual(NOTICE_WORDS);
  });
});

const COPIES = {
  local_models_missing: 'mainPanel.localModelsRequired',
  no_microphone: 'modePicker.missingDevice',
  silent_no_permission: 'audioPanel.participantNoAudioYet',
  loopback_denied: 'audioPanel.screenRecordingDeniedText1',
} as const;
const at = (tree: unknown, path: string) => path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], tree);
const catalogs = import.meta.glob('../../locales/*/translation.json', { eager: true, import: 'default' });
it('words the four new codes with a sentence every locale already has', () => {
  expect(Object.keys(catalogs)).toHaveLength(30);
  for (const [path, catalog] of Object.entries(catalogs)) {
    for (const [code, key] of Object.entries(COPIES)) {
      expect(at(catalog, `notices.${code}`), `${path}: ${code}`).toBe(at(catalog, key));
    }
  }
});
