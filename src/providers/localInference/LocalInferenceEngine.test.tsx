import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

// Prefixed "mock" so Vitest hoists it alongside the vi.mock factories below.
const mockOverrides: unknown[] = [];
vi.mock('../../components/Settings/engine/useWasmEngineAdapter', () => ({
  useWasmEngineAdapter: (_disabled: boolean, override: unknown) => { mockOverrides.push(override); return {}; },
}));
const seenEngineSurfaceProps: any[] = [];
vi.mock('../../components/Settings/engine/EngineSurface', () => ({
  EngineSurface: (props: any) => { seenEngineSurfaceProps.push(props); return null; },
}));
vi.mock('../../components/Settings/sections/ModelManagementSection', () => ({ ModelManagementSection: () => null }));
vi.mock('../../components/Settings/engine/StoragePage', () => ({ StoragePage: () => null }));

import { LocalInferenceEngine } from './LocalInferenceEngine';
import { LOCAL_INFERENCE_DEFAULTS } from './settings';

beforeEach(() => {
  mockOverrides.length = 0;
  seenEngineSurfaceProps.length = 0;
});

describe('LocalInferenceEngine', () => {
  it("keys its engine adapter's override on the pair's languages, not on the pair object", () => {
    const update = vi.fn();
    const { rerender } = render(
      <LocalInferenceEngine settings={LOCAL_INFERENCE_DEFAULTS} update={update} pair={{ source: 'ja', target: 'en' }} legs={['speaker']} />,
    );
    // The store hands out a new pair object on every settings write (`normalizePair`).
    rerender(
      <LocalInferenceEngine settings={LOCAL_INFERENCE_DEFAULTS} update={update} pair={{ source: 'ja', target: 'en' }} legs={['speaker']} />,
    );
    expect(mockOverrides).toHaveLength(2);
    expect(mockOverrides[1]).toBe(mockOverrides[0]);
    rerender(
      <LocalInferenceEngine settings={LOCAL_INFERENCE_DEFAULTS} update={update} pair={{ source: 'en', target: 'ja' }} legs={['speaker']} />,
    );
    expect(mockOverrides[2]).not.toBe(mockOverrides[1]);
    expect(mockOverrides[2]).toMatchObject({ pair: { source: 'en', target: 'ja' } });
  });

  it("passes 'both' as the effective mode when both legs run", () => {
    render(<LocalInferenceEngine settings={LOCAL_INFERENCE_DEFAULTS} update={vi.fn()} legs={['speaker', 'participant']} />);
    expect(seenEngineSurfaceProps[0].effectiveMode).toBe('both');
  });

  it("passes 'participant' as the effective mode for the participant leg alone", () => {
    render(<LocalInferenceEngine settings={LOCAL_INFERENCE_DEFAULTS} update={vi.fn()} legs={['participant']} />);
    expect(seenEngineSurfaceProps[0].effectiveMode).toBe('participant');
  });

  it("passes 'speaker' as the effective mode for the speaker leg alone", () => {
    render(<LocalInferenceEngine settings={LOCAL_INFERENCE_DEFAULTS} update={vi.fn()} legs={['speaker']} />);
    expect(seenEngineSurfaceProps[0].effectiveMode).toBe('speaker');
  });

  it('passes initialSlot and onInitialSlotConsumed through to EngineSurface', () => {
    const onInitialSlotConsumed = vi.fn();
    const slot = { dir: 'ja→en', stage: 'asr' as const };
    render(
      <LocalInferenceEngine
        settings={LOCAL_INFERENCE_DEFAULTS}
        update={vi.fn()}
        legs={['speaker']}
        initialSlot={slot}
        onInitialSlotConsumed={onInitialSlotConsumed}
      />,
    );
    expect(seenEngineSurfaceProps[0].initialSlot).toBe(slot);
    expect(seenEngineSurfaceProps[0].onInitialSlotConsumed).toBe(onInitialSlotConsumed);
  });
});
