import { describe, it, expect, vi, beforeEach } from 'vitest';

// The gate only runs inside Electron; force the environment check on.
vi.mock('../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/environment')>()),
  isElectron: () => true,
}));

import { useSettingsStore } from './settingsStore';
import { useNativeModelStore } from './nativeModelStore';
import { Provider } from '../types/Provider';

describe('validateApiKey LOCAL_NATIVE engine gating (spec S2/S10)', () => {
  beforeEach(() => {
    useSettingsStore.setState({ provider: Provider.LOCAL_NATIVE });
    // Stub the store actions the branch calls so no WS/IPC is attempted.
    useNativeModelStore.setState({
      ensureCatalog: async () => {},
      refreshBundle: async () => {},
    } as never);
  });

  it('mismatch: reports that the engine needs an update', async () => {
    useNativeModelStore.setState({ sidecarStatus: 'unavailable', bundleStatus: 'mismatch' } as never);
    const r = await useSettingsStore.getState().validateApiKey();
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/engine needs an update/i);
  });

  it('absent: points at the engine download', async () => {
    useNativeModelStore.setState({ sidecarStatus: 'unavailable', bundleStatus: 'absent' } as never);
    const r = await useSettingsStore.getState().validateApiKey();
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/download the inference engine/i);
  });

  it('engine fine but sidecar down: keeps the generic unavailable message', async () => {
    useNativeModelStore.setState({ sidecarStatus: 'unavailable', bundleStatus: 'ready' } as never);
    const r = await useSettingsStore.getState().validateApiKey();
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/unavailable/i);
  });
});
