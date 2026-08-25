// The seam Help's "Restart Setup Guide" goes through. The wizard seeds its own
// ctx from the draft it just applied; this hook has to build one from the live
// stores instead — and the stored setup record is months old by then, so every
// field that can drift must come from the store, not the record.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('../../stores/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ provider: 'openai', textOnly: false, isApiKeyValid: true }) },
}));
// `provider` here is deliberately stale — the user has since switched to
// OpenAI. buildTourCtx must read the store's provider and ignore this one.
vi.mock('../../stores/setupStore', () => ({
  useSetupStore: { getState: () => ({ setup: { scenario: 'be-heard', providerPath: 'own-key', provider: 'kizunaai_soniox' } }) },
}));
vi.mock('../../stores/audioStore', () => ({ default: { getState: () => ({ mode: 'speaker' }) } }));
vi.mock('../../lib/auth/hooks', () => ({ useAuth: () => ({ isSignedIn: true }) }));
vi.mock('../../utils/environment', () => ({
  isElectron: () => true, isLinux: () => true, isMacOS: () => false, isWindows: () => false,
}));
const startSpy = vi.fn();
vi.mock('./TourProvider', () => ({ useTour: () => ({ start: startSpy }) }));

import { useStartBasicsTour } from './useStartBasicsTour';

const Probe: React.FC = () => {
  const startTour = useStartBasicsTour();
  return <button type="button" onClick={startTour}>restart</button>;
};

beforeEach(() => { cleanup(); startSpy.mockClear(); });

describe('useStartBasicsTour', () => {
  it('builds the ctx from the live stores, not from the stored setup record', () => {
    render(<Probe />);
    fireEvent.click(screen.getByRole('button', { name: 'restart' }));

    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(startSpy).toHaveBeenCalledWith(expect.objectContaining({
      // From the record: only the two fields nothing else can supply.
      scenario: 'be-heard', providerPath: 'own-key',
      // From the stores and the environment — provider above all, which the
      // record still has as kizunaai_soniox.
      provider: 'openai', mode: 'speaker', textOnly: false,
      isSignedIn: true, apiKeyValid: true, platform: 'electron', os: 'linux',
    }));
  });
});
