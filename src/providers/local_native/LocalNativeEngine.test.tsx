import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useContext } from 'react';

const seen = vi.hoisted(() => ({ overrides: [] as unknown[], modes: [] as string[], ports: [] as unknown[] }));
vi.mock('../../components/Settings/engine/useNativeEngineAdapter', () => ({
  useNativeEngineAdapter: (_active: boolean, override: unknown) => { seen.overrides.push(override); return {}; },
}));
vi.mock('../../components/Settings/engine/EngineSurface', async () => {
  const { VoicePreviewContext } = await import('../../components/providers/VoicePreviewContext');
  return {
    EngineSurface: ({ effectiveMode }: { effectiveMode: string }) => {
      seen.modes.push(effectiveMode);
      seen.ports.push(useContext(VoicePreviewContext));
      return null;
    },
  };
});

import { LocalNativeEngine } from './LocalNativeEngine';
import { LOCAL_NATIVE_DEFAULTS } from './settings';

describe('LocalNativeEngine', () => {
  it('keys the override on the pair\'s languages, shows the legs\' mode, and provides the preview port (#578 ruling 13)', () => {
    const update = vi.fn();
    const port = { play: vi.fn(), stop: vi.fn() };
    const { rerender } = render(<LocalNativeEngine settings={LOCAL_NATIVE_DEFAULTS} update={update} pair={{ source: 'ja', target: 'en' }} legs={['participant']} preview={port} />);
    rerender(<LocalNativeEngine settings={LOCAL_NATIVE_DEFAULTS} update={update} pair={{ source: 'ja', target: 'en' }} legs={['participant']} preview={port} />);
    expect(seen.overrides[0]).toBe(seen.overrides[1]);
    expect(seen.modes).toEqual(['participant', 'participant']);
    expect(seen.ports[0]).toBe(port);
  });
});
