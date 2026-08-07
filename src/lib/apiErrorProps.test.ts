import { describe, it, expect } from 'vitest';
import { buildApiErrorProps } from './apiErrorProps';

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
});
