import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

// Prefixed "mock" so Vitest hoists it alongside the vi.mock factories below.
const mockOverrides: unknown[] = [];
vi.mock('../../components/Settings/engine/useWasmEngineAdapter', () => ({
  useWasmEngineAdapter: (_disabled: boolean, override: unknown) => { mockOverrides.push(override); return {}; },
}));
vi.mock('../../components/Settings/engine/EngineSurface', () => ({ EngineSurface: () => null }));
vi.mock('../../components/Settings/sections/ModelManagementSection', () => ({ ModelManagementSection: () => null }));
vi.mock('../../components/Settings/engine/StoragePage', () => ({ StoragePage: () => null }));

import { LocalInferenceEngine } from './LocalInferenceEngine';
import { LOCAL_INFERENCE_DEFAULTS } from './settings';

beforeEach(() => {
  mockOverrides.length = 0;
});

describe('LocalInferenceEngine', () => {
  it("keys its engine adapter's override on the pair's languages, not on the pair object", () => {
    const update = vi.fn();
    const { rerender } = render(<LocalInferenceEngine settings={LOCAL_INFERENCE_DEFAULTS} update={update} pair={{ source: 'ja', target: 'en' }} />);
    // The store hands out a new pair object on every settings write (`normalizePair`).
    rerender(<LocalInferenceEngine settings={LOCAL_INFERENCE_DEFAULTS} update={update} pair={{ source: 'ja', target: 'en' }} />);
    expect(mockOverrides).toHaveLength(2);
    expect(mockOverrides[1]).toBe(mockOverrides[0]);
    rerender(<LocalInferenceEngine settings={LOCAL_INFERENCE_DEFAULTS} update={update} pair={{ source: 'en', target: 'ja' }} />);
    expect(mockOverrides[2]).not.toBe(mockOverrides[1]);
    expect(mockOverrides[2]).toMatchObject({ pair: { source: 'en', target: 'ja' } });
  });
});
