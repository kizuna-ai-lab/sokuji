import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { useContext } from 'react';

const seen = vi.hoisted(() => ({
  overrides: [] as unknown[],
  surfaces: [] as Array<{ effectiveMode: string; onBrowse?: (slot: { dir: string; stage: string }) => void; port: unknown }>,
  sections: [] as Array<{ isSessionActive?: boolean }>,
  libraries: [] as Array<Record<string, unknown>>,
}));
vi.mock('../../components/Settings/engine/useNativeEngineAdapter', () => ({
  useNativeEngineAdapter: (_active: boolean, override: unknown) => { seen.overrides.push(override); return {}; },
}));
vi.mock('../../components/Settings/engine/EngineSurface', async () => {
  const { VoicePreviewContext } = await import('../../components/providers/VoicePreviewContext');
  return {
    EngineSurface: ({ effectiveMode, onBrowse }: { effectiveMode: string; onBrowse?: (slot: { dir: string; stage: string }) => void }) => {
      seen.surfaces.push({ effectiveMode, onBrowse, port: useContext(VoicePreviewContext) });
      return null;
    },
  };
});
vi.mock('../../components/Settings/sections/EngineSection', () => ({
  EngineSection: (props: { isSessionActive?: boolean }) => { seen.sections.push(props); return null; },
}));
vi.mock('../../components/Settings/sections/NativeModelManagementSection', () => ({
  NativeModelManagementSection: (props: Record<string, unknown>) => { seen.libraries.push(props); return null; },
}));

import { LocalNativeEngine } from './LocalNativeEngine';
import { LOCAL_NATIVE_DEFAULTS } from './settings';

beforeEach(() => {
  seen.overrides.length = 0;
  seen.surfaces.length = 0;
  seen.sections.length = 0;
  seen.libraries.length = 0;
});

describe('LocalNativeEngine', () => {
  it("draws the engine card and the slots over the host's settings, update and pair", () => {
    const update = vi.fn();
    const { rerender } = render(<LocalNativeEngine settings={LOCAL_NATIVE_DEFAULTS} update={update} pair={{ source: 'ja', target: 'en' }} legs={['participant']} disabled />);
    // A new pair object with the same languages keeps the override: the store hands out a new one on every write.
    rerender(<LocalNativeEngine settings={LOCAL_NATIVE_DEFAULTS} update={update} pair={{ source: 'ja', target: 'en' }} legs={['participant']} disabled />);
    expect(seen.sections[0]).toEqual({ isSessionActive: true });
    expect(seen.overrides[0]).toEqual({ settings: LOCAL_NATIVE_DEFAULTS, update, pair: { source: 'ja', target: 'en' } });
    expect(seen.overrides[1]).toBe(seen.overrides[0]);
    expect(seen.surfaces.map((s) => s.effectiveMode)).toEqual(['participant', 'participant']);
    expect(seen.libraries).toEqual([]);
  });

  it("a slot's Browse shows that stage of the native library for the slot's direction, under the slots", () => {
    const update = vi.fn();
    render(<LocalNativeEngine settings={LOCAL_NATIVE_DEFAULTS} update={update} pair={{ source: 'ja', target: 'en' }} legs={['speaker']} />);
    act(() => { seen.surfaces[0].onBrowse?.({ dir: 'en→ja', stage: 'tts' }); });
    expect(seen.libraries[seen.libraries.length - 1]).toEqual({
      stageFilter: 'tts', direction: 'en→ja', settings: LOCAL_NATIVE_DEFAULTS, update, pair: { source: 'ja', target: 'en' }, isSessionActive: false,
    });
  });

  it("hands its voice previews the app's route (#578 ruling 13)", () => {
    const port = { play: vi.fn(), stop: vi.fn() };
    render(<LocalNativeEngine settings={LOCAL_NATIVE_DEFAULTS} update={vi.fn()} pair={{ source: 'ja', target: 'en' }} legs={['speaker']} preview={port as never} />);
    expect(seen.surfaces[0].port).toBe(port);
  });
});
