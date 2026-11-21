import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

// Every released provider offered, as a release offers them.
vi.mock('../../providers/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers/registry')>();
  return { ...actual, presentProviders: () => actual.RELEASED };
});

import { RELEASED } from '../../providers/registry';
import useAudioStore from '../../stores/audioStore';
import { useLineUpStore } from '../../stores/lineUpStore';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';
import useSettingsStore from '../../stores/settingsStore';
import { useLineUpNotice } from './useLineUpNotice';

const entry = (id: string, target: string) => ({ settings: RELEASED.find((p) => p.id === id)!.settings.defaults, credentials: { apiKey: 'k' }, pair: { source: 'en', target } });
/** Every provider of the plan loaded, translating into `target`. */
const into = (target: string) => useProviderStore.setState({ entries: { soniox: entry('soniox', target), local_inference: entry('local_inference', target) } as never });
// Soniox's text read by Edge: Edge has no Basque voice.
const sonioxWithEdge = { transcription: 'soniox', translation: 'soniox', speech: 'edge', summarisation: null };
const noVoice = { code: 'lineup_language_not_spoken', stage: 'speech', params: { provider: 'edge', language: 'eu' } };

const providersBefore = useProviderStore.getState();

beforeEach(() => {
  useProviderStore.setState({ entries: {}, readiness: {} });
  useLineUpStore.setState({ lineUp: sonioxWithEdge, stored: true, unstoredProvider: null });
  useSettingsStore.setState({ textOnly: false });
  useAudioStore.setState({ mode: 'speaker' });
  useRoutingStore.setState({ participantSpeech: null });
});
afterEach(() => {
  cleanup();
  useProviderStore.setState(providersBefore, true);
});

describe('useLineUpNotice', () => {
  it('follows the pair: the line comes and goes with the target language, the line-up unchanged', () => {
    into('ja');
    const { result } = renderHook(() => useLineUpNotice());
    expect(result.current).toBeNull();
    act(() => into('eu'));
    expect(result.current).toMatchObject(noVoice);
    act(() => into('ja'));
    expect(result.current).toBeNull();
  });

  it('follows the text-only switch: nothing is read aloud, so nothing is refused', () => {
    into('eu');
    const { result } = renderHook(() => useLineUpNotice());
    expect(result.current).toMatchObject(noVoice);
    act(() => useSettingsStore.setState({ textOnly: true }));
    expect(result.current).toBeNull();
    act(() => useSettingsStore.setState({ textOnly: false }));
    expect(result.current).toMatchObject(noVoice);
  });

  it('follows the mode and who hears: the other side, read to me in a language the voice has', () => {
    into('eu');
    const { result } = renderHook(() => useLineUpNotice());
    expect(result.current).toMatchObject(noVoice);
    // The participant leg alone translates into English; whether it is read aloud is its own switch.
    act(() => useAudioStore.setState({ mode: 'participant' }));
    expect(result.current).toBeNull();
    act(() => useAudioStore.setState({ mode: 'speaker' }));
    expect(result.current).toMatchObject(noVoice);
  });

  it('follows the line-up, and a plan the composer refuses', () => {
    into('eu');
    const { result } = renderHook(() => useLineUpNotice());
    act(() => useLineUpStore.setState({ lineUp: { ...sonioxWithEdge, speech: 'soniox' } }));
    expect(result.current).toBeNull();
    act(() => useLineUpStore.setState({ lineUp: { ...sonioxWithEdge, speech: null } }));
    expect(result.current).toMatchObject({ code: 'lineup_incomplete', stage: 'speech' });
  });

  it('answers with the same object while nothing it reads changes', () => {
    into('eu');
    const { result, rerender } = renderHook(() => useLineUpNotice());
    const first = result.current;
    rerender();
    act(() => useSettingsStore.setState({ settingsNavigationTarget: null }));
    expect(result.current).toBe(first);
  });
});
