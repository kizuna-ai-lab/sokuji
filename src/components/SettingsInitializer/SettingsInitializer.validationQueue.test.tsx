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

// LOCAL_NATIVE's effect warms the sidecar before validating; stub the facade so
// the readiness-input tests below never reach it.
vi.mock('../../stores/nativeModelStore', () => ({
  useNativeModelStore: {
    getState: () => ({
      ensureCatalog: async () => undefined,
      ensureSelectionReady: async () => ({ ready: true, reason: 'ready', corrections: null }),
    }),
  },
}));

const { default: useSettingsStore } = await import('../../stores/settingsStore');
const { default: useAudioStore } = await import('../../stores/audioStore');
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

  // Codex review on PR #413. One slice now holds three independent keys while
  // `isApiKeyValid` is a single verdict, so a region switch leaves the standing
  // verdict describing a key that is no longer active: Start stays enabled on a
  // region whose key is empty (and fails at connect), or stays disabled on a
  // region whose key is already good.
  it('re-validates when the Soniox region changes', async () => {
    useSettingsStore.setState({ provider: Provider.SONIOX } as never);
    render(<SettingsInitializer />);
    expect(validateMock).toHaveBeenCalledTimes(1);
    await act(async () => { resolveFirst!(); });

    act(() => {
      useSettingsStore.setState((s: any) => ({ soniox: { ...s.soniox, region: 'eu' } }));
    });
    expect(validateMock).toHaveBeenCalledTimes(2);
  });

  // Codex review on PR #434. LOCAL_NATIVE readiness asks whether the session
  // needs a TTS model, and that answer is now `effectiveTextOnly(speaker leg in
  // scope, the toggle)` — so the audio mode is a readiness input. The native
  // effect is the ONLY thing that re-runs validateApiKey for this provider (the
  // generic credential effect skips LOCAL_NATIVE), so an untracked input leaves
  // the verdict standing: fail readiness in Speaker for a missing voice, switch
  // to Others, and Start stays disabled forever even though a participant-only
  // session never loads a voice. The opposite direction is caught by
  // prepareToStart's revalidate, but it fails at Start rather than never lying.
  //
  // `textOnly` is the other half of the same derived value and was already
  // untracked before this PR — same staleness, same one-line cause.
  describe('LOCAL_NATIVE readiness inputs', () => {
    const renderNative = async () => {
      useSettingsStore.setState({ provider: Provider.LOCAL_NATIVE } as never);
      useAudioStore.setState({ mode: 'speaker' } as never);
      render(<SettingsInitializer />);
      // The native effect awaits ensureCatalog before validating.
      await act(async () => { resolveFirst?.(); });
      validateMock.mockClear();
    };

    it('re-validates when the audio mode changes', async () => {
      await renderNative();
      await act(async () => {
        useAudioStore.setState({ mode: 'participant' } as never);
      });
      expect(validateMock).toHaveBeenCalled();
    });

    it('re-validates when the text-only toggle changes', async () => {
      await renderNative();
      await act(async () => {
        useSettingsStore.setState({ textOnly: true } as never);
      });
      expect(validateMock).toHaveBeenCalled();
    });
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
