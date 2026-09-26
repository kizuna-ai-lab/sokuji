import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

// Unlike SpeechSection.test.tsx, Tooltip is NOT mocked here: these tests
// check the real trigger's DOM position and click behavior, which a mock
// that just captures `content` and renders null cannot exercise.
vi.mock('../../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key) }) };
});
vi.mock('../../../providers/registry', async () => {
  const { localInferenceProvider } = await import('../../../providers/localInference/provider');
  return { presentProviders: () => [localInferenceProvider] };
});
const asr = vi.hoisted(() => ({ entry: undefined as { type?: string; asrWorkerType?: string } | undefined }));
vi.mock('../../../lib/local-inference/modelManifest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/local-inference/modelManifest')>();
  return { ...actual, getManifestEntry: (id: string) => (id === 'asr-model' ? asr.entry : actual.getManifestEntry(id)) };
});

import { LOCAL_INFERENCE_DEFAULTS } from '../../../providers/localInference/settings';
import { useModelStore } from '../../../stores/modelStore';
import { useProviderStore } from '../../../stores/providerStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useTurnModeStore } from '../../../stores/turnModeStore';
import { SpeechSection } from './SpeechSection';

const localEntry = () => ({ settings: { ...LOCAL_INFERENCE_DEFAULTS }, credentials: {}, pair: { source: 'ja', target: 'en' } });
const originalResolve = useModelStore.getState().resolve;

beforeEach(() => {
  useProviderStore.setState({ selected: 'localInference', entries: { localInference: localEntry() }, readiness: {} });
  useSettingsStore.setState({ settingsNavigationTarget: null });
  useTurnModeStore.setState({ turnMode: 'auto' });
  asr.entry = { type: 'asr', asrWorkerType: 'whisper-webgpu' };
  useModelStore.setState({ resolve: () => ({ asr: { modelId: 'asr-model' }, translation: null, tts: null }) } as unknown as Partial<ReturnType<typeof useModelStore.getState>>);
});

afterEach(() => {
  useProviderStore.setState({ selected: null, entries: {}, readiness: {} });
  useModelStore.setState({ resolve: originalResolve });
});

describe("SpeechSection — the provider tuning row's help tooltip trigger", () => {
  it('Advanced: sits beside the link button, not inside it, and hovering or clicking it navigates nowhere', () => {
    const { container } = render(<SpeechSection locked={false} layout="advanced" />);
    const row = container.querySelector('.turn-detection-tuning')!;
    const button = row.querySelector('button.turn-detection-link') as HTMLElement;
    const trigger = row.querySelector('.tooltip-trigger') as HTMLElement;
    expect(button).toBeTruthy();
    expect(trigger).toBeTruthy();

    // Not nested inside the link button.
    expect(button.contains(trigger)).toBe(false);
    // A sibling positioned after it.
    // eslint-disable-next-line no-bitwise
    expect(button.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // The trigger is its own hover/click target: it must not also fire the
    // link's navigation.
    fireEvent.mouseEnter(trigger);
    fireEvent.click(trigger);
    expect(useSettingsStore.getState().settingsNavigationTarget).toBeNull();

    fireEvent.click(button);
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('turn-detection-tuning');
  });

  it('Simple: sits after the summary text, with no button anywhere in the row', () => {
    const { container } = render(<SpeechSection locked={false} layout="simple" />);
    const row = container.querySelector('.turn-detection-tuning')!;
    const summary = row.querySelector('.turn-detection-summary') as HTMLElement;
    const trigger = row.querySelector('.tooltip-trigger') as HTMLElement;
    expect(row.querySelector('button')).toBeNull();
    expect(summary).toBeTruthy();
    expect(trigger).toBeTruthy();
    // eslint-disable-next-line no-bitwise
    expect(summary.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
