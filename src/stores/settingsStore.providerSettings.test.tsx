// Regression test for the SubtitleApp staleness bug: the bar showed the
// initial provider language pair forever, even after the user switched
// sourceLanguage/targetLanguage. Root cause was a useMemo with deps that
// never invalidated when `state[provider]` was replaced (same provider
// name → same memo cache → stale reference).
//
// The fix is a Zustand selector hook that re-emits whenever the resolved
// `state[provider]` reference changes. This test exercises that hook
// behavior end-to-end against the real store.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';

vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_k: string, d: unknown) => d,
      setSetting: async () => undefined,
    }),
  },
}));

// Import after mocks
const { default: useSettingsStore, useCurrentProviderSettings } =
  await import('./settingsStore');

function Probe() {
  const settings = useCurrentProviderSettings() as any;
  return <div data-testid="src">{settings?.sourceLanguage ?? '?'}</div>;
}

describe('useCurrentProviderSettings', () => {
  beforeEach(() => {
    // Reset to a clean known state for each test.
    useSettingsStore.setState({
      provider: 'local_inference' as any,
      localInference: {
        ...(useSettingsStore.getState() as any).localInference,
        sourceLanguage: 'ja',
        targetLanguage: 'en',
      } as any,
    } as any);
  });

  it('returns the initial sourceLanguage of the active provider', () => {
    const { getByTestId } = render(<Probe />);
    expect(getByTestId('src').textContent).toBe('ja');
  });

  it('re-renders when state[provider] is replaced without provider name change', () => {
    // The exact scenario behind the JA→EN-forever bug: user is on
    // local_inference, picks a different sourceLanguage. `provider`
    // stays the same; only state.localInference is replaced.
    const { getByTestId } = render(<Probe />);
    expect(getByTestId('src').textContent).toBe('ja');

    act(() => {
      useSettingsStore.setState((s: any) => ({
        localInference: { ...s.localInference, sourceLanguage: 'fr' },
      }));
    });

    expect(getByTestId('src').textContent).toBe('fr');
  });

  it('re-renders when the provider itself switches', () => {
    const { getByTestId } = render(<Probe />);
    expect(getByTestId('src').textContent).toBe('ja');

    act(() => {
      useSettingsStore.setState({ provider: 'openai' as any });
    });

    // OpenAI default sourceLanguage is 'en'.
    expect(getByTestId('src').textContent).toBe('en');
  });
});
