// The seam Help's "Restart Setup Guide" goes through. The wizard seeds its own
// ctx from the draft it just applied; this hook has to build one from the live
// stores instead — and the stored setup record is months old by then, so every
// field that can drift must come from the store, not the record. Only the
// scenario is read from the record.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('../../stores/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ provider: 'kizunaai_soniox', textOnly: false, isApiKeyValid: true }) },
}));
// The record is deliberately stale, and by no fault of the user: they finished
// the wizard on the offline path, then signed in, and MainLayout's Basic-mode
// rule auto-switched them to the managed provider. Reading `providerPath` off
// this record put the `models` step in the tour, whose engine-chips anchor the
// managed ProviderSection never renders — it stalled, then skipped itself.
vi.mock('../../stores/setupStore', () => ({
  useSetupStore: { getState: () => ({ setup: { scenario: 'be-heard', providerPath: 'offline', provider: 'local_inference' } }) },
}));
vi.mock('../../stores/audioStore', () => ({ default: { getState: () => ({ mode: 'speaker' }) } }));
vi.mock('../../lib/auth/hooks', () => ({ useAuth: () => ({ isSignedIn: true }) }));
vi.mock('../../utils/environment', () => ({
  isElectron: () => true, isExtension: () => false, isLinux: () => true, isMacOS: () => false, isWindows: () => false,
}));
const setShowSettings = vi.fn();
vi.mock('../../stores/layoutStore', () => ({ useLayoutStore: { getState: () => ({ setShowSettings }) } }));
const startSpy = vi.fn();
vi.mock('./TourProvider', () => ({ useTour: () => ({ start: startSpy }) }));

import { useStartBasicsTour } from './useStartBasicsTour';

const Probe: React.FC = () => {
  const startTour = useStartBasicsTour();
  return <button type="button" onClick={startTour}>restart</button>;
};

beforeEach(() => { cleanup(); startSpy.mockClear(); setShowSettings.mockClear(); });

describe('useStartBasicsTour', () => {
  it('builds the ctx from the live stores, not from the stored setup record', () => {
    render(<Probe />);
    fireEvent.click(screen.getByRole('button', { name: 'restart' }));

    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(startSpy).toHaveBeenCalledWith(expect.objectContaining({
      // From the record: the scenario, and nothing else — it is the one field
      // no live store can supply.
      scenario: 'be-heard',
      // Everything else from the stores and the environment, the provider path
      // included: derived from the live provider, never from the record's.
      providerPath: 'managed',
      provider: 'kizunaai_soniox', mode: 'speaker', textOnly: false,
      isSignedIn: true, apiKeyValid: true, platform: 'electron', os: 'linux',
    }));
  });

  it('closes the settings panel before starting, wherever it was invoked from', () => {
    // SimpleSettings renders HelpSection without a toggleSettings prop, so the
    // link alone leaves the panel open under the restarted tour. Closing here
    // covers every caller; the steps that need the panel reopen it in prepare.
    render(<Probe />);
    fireEvent.click(screen.getByRole('button', { name: 'restart' }));

    expect(setShowSettings).toHaveBeenCalledWith(false);
    expect(setShowSettings.mock.invocationCallOrder[0]).toBeLessThan(startSpy.mock.invocationCallOrder[0]);
  });
});
