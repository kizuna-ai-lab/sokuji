import { describe, it, expect } from 'vitest';
import { buildApiErrorProps, clientErrorMessage } from './apiErrorProps';

describe('buildApiErrorProps', () => {
  it('prefers rawMessage: a client that localizes `message` for the UI puts the untranslated original there', () => {
    const props = buildApiErrorProps(
      {
        code: '503',
        message: '接続が中断されました——少ししてから「セッション開始」をタップして続けてください。',
        rawMessage: 'service unavailable',
      },
      'soniox'
    );
    expect(props.error_message).toBe('service unavailable');
  });

  it('falls back to message, then error, then a placeholder', () => {
    expect(buildApiErrorProps({ message: 'boom' }, 'openai').error_message).toBe('boom');
    expect(buildApiErrorProps({ error: 'boom' }, 'openai').error_message).toBe('boom');
    expect(buildApiErrorProps({}, 'openai').error_message).toBe('Unknown error');
  });

  it('carries the wire code so outages can be grouped by cause', () => {
    expect(buildApiErrorProps({ code: '503' }, 'soniox').error_code).toBe('503');
    // Symbolic codes matter as much as numeric ones — socket_error is a
    // transport failure with no HTTP status at all.
    expect(buildApiErrorProps({ code: 'socket_error' }, 'soniox').error_code).toBe('socket_error');
    // Numeric codes reach us as numbers from some clients; one field, one type.
    expect(buildApiErrorProps({ code: 408 }, 'soniox').error_code).toBe('408');
  });

  it('omits error_code entirely when the client reported none, rather than sending undefined', () => {
    const props = buildApiErrorProps({ message: 'boom' }, 'openai');
    expect('error_code' in props).toBe(false);
  });

  it('does not treat an empty-string code as a code', () => {
    expect('error_code' in buildApiErrorProps({ code: '', message: 'boom' }, 'openai')).toBe(false);
  });

  it('passes the provider through and preserves the existing error_type mapping', () => {
    expect(buildApiErrorProps({ type: 'error' }, 'gemini')).toMatchObject({
      provider: 'gemini',
      error_type: 'client',
    });
    expect(buildApiErrorProps({}, 'gemini').error_type).toBe('server');
  });

  it('tags which leg reported the error, so split-mode outages are not half-invisible', () => {
    // A split Both session runs two independent Soniox streams. Without this
    // tag the participant leg's failures are indistinguishable from the
    // speaker's in api_error, and an outage that only kills one direction
    // reads as a 50% drop in traffic rather than as an incident.
    expect(buildApiErrorProps({ code: '503' }, 'soniox', 'participant').channel).toBe('participant');
    expect(buildApiErrorProps({ code: '503' }, 'soniox', 'speaker').channel).toBe('speaker');
  });

  it('omits channel entirely when the caller did not name a leg, rather than sending undefined', () => {
    // Same reasoning as error_code above: an absent property and a property
    // whose value is undefined are different rows once they reach PostHog.
    expect('channel' in buildApiErrorProps({ message: 'boom' }, 'openai')).toBe(false);
  });

  it('exposes the same message-precedence the bubble uses, so both cannot drift', () => {
    expect(clientErrorMessage({ message: 'boom' })).toBe('boom');
    expect(clientErrorMessage({ error: 'boom' })).toBe('boom');
    expect(clientErrorMessage({})).toBe('Unknown error');
    // Note the deliberate difference from error_message: the USER-facing text
    // prefers the localized `message`, analytics prefers `rawMessage`.
    expect(clientErrorMessage({ message: '接続が中断されました', rawMessage: 'service unavailable' }))
      .toBe('接続が中断されました');
  });
});
