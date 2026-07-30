/**
 * Regression test for a bot-review finding on PR #369: credential changes
 * arriving while a validation is already in flight were silently dropped by
 * the isValidatingRef guard — the finally callback only cleared the ref and
 * never re-validated, so isApiKeyValid could reflect a stale key or auth
 * mode until the user clicked Validate manually. The initializer must queue
 * exactly one rerun; validateApiKey reads the latest store state at call
 * time, so the follow-up run covers the final values.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';

vi.mock('../../lib/auth/hooks', () => ({
  useAuth: () => ({ isSignedIn: false, getToken: undefined }),
}));

vi.mock('../../lib/edge-tts/voiceList', () => ({
  getEdgeTtsVoices: async () => [],
  filterVoicesByLanguage: () => [],
}));

const { default: useSettingsStore } = await import('../../stores/settingsStore');
const { Provider } = await import('../../types/Provider');
const { SettingsInitializer } = await import('./SettingsInitializer');

describe('SettingsInitializer — validation rerun queue', () => {
  let resolveFirst: (() => void) | undefined;
  let validateMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resolveFirst = undefined;
    validateMock = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          if (!resolveFirst) {
            resolveFirst = resolve; // first call stays pending until the test releases it
          } else {
            resolve();
          }
        }),
    );
    useSettingsStore.setState({
      settingsLoaded: true,
      provider: Provider.OPENAI,
      validateApiKey: validateMock,
    } as never);
  });

  it('re-validates once more when credentials change during an in-flight validation', async () => {
    render(<SettingsInitializer />);
    expect(validateMock).toHaveBeenCalledTimes(1);

    // Credential change while the first validation is still pending
    act(() => {
      useSettingsStore.setState((s: any) => ({ openai: { ...s.openai, apiKey: 'sk-new' } }));
    });
    expect(validateMock).toHaveBeenCalledTimes(1); // guarded — must be queued, not run concurrently

    await act(async () => {
      resolveFirst!();
    });
    expect(validateMock).toHaveBeenCalledTimes(2); // queued rerun fired with the latest state
  });

  it('does not rerun when nothing changed during the validation', async () => {
    render(<SettingsInitializer />);
    expect(validateMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst!();
    });
    expect(validateMock).toHaveBeenCalledTimes(1);
  });
});
