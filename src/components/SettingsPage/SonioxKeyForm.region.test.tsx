// A pasted Soniox key's region, through the form and the app's own region change: a key that belongs to another region,
// with a custom voice in the selected region, is not followed there without asking. Cancel keeps the selected region
// and its key; confirm moves the region and keeps the one key. Only the voice reconciliation and storage are stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));
vi.mock('../../providers/soniox/voiceFieldReconcile', () => ({ reconcileSonioxVoiceField: async () => {} }));

import '../../locales';
import { registerRunPhase } from '../../app/runPhase';
import { sonioxProvider } from '../../providers/soniox/provider';
import type { KeyRegions } from '../../providers/soniox/keyRegion';
import { useProviderStore } from '../../stores/providerStore';
import { useRegionChangeStore } from '../../stores/regionChangeStore';
import { SonioxKeyForm } from './SonioxKeyForm';

const auth = { signedIn: false, getToken: async () => null };
const entry = () => useProviderStore.getState().entries.soniox!;
const creds = () => entry().credentials as Record<string, string>;
const region = () => (entry().settings as { region: string }).region;
const inJapan = async (): Promise<KeyRegions> => ({ accepted: ['jp'], unreachable: [] });

beforeEach(async () => {
  registerRunPhase(() => 'idle');
  useRegionChangeStore.setState({ question: null });
  useProviderStore.setState({ entries: {}, selected: 'soniox', selectionLocked: false, intent: undefined, readiness: {} });
  await useProviderStore.getState().load(sonioxProvider);
  await useProviderStore.getState().updateSettings(sonioxProvider, { region: 'us', voice: 'uuid-us' });
  useProviderStore.getState().setCredential(sonioxProvider, 'apiKey', 'sk-us');
  // The key's check, answered here: never asked of Soniox.
  useProviderStore.setState({ refreshReadiness: (async () => ({ state: 'unknown' })) as never });
});
afterEach(() => cleanup());

async function pasteJapanKey() {
  render(<SonioxKeyForm provider={sonioxProvider} auth={auth} disabled={false} detect={inJapan} />);
  fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-jp' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save and find its region' }));
  await waitFor(() => expect(useRegionChangeStore.getState().question).toMatchObject({ providerId: 'soniox', from: 'us', to: 'jp' }));
}

describe("a pasted key of another region, with a custom voice in this one", () => {
  it('asks first; Cancel keeps the region and the key that works in it', async () => {
    await pasteJapanKey();
    expect(region()).toBe('us');
    useRegionChangeStore.getState().answer(false);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save and find its region' })).toBeInTheDocument());
    expect(region()).toBe('us');
    expect(creds().apiKey).toBe('sk-us');
    expect(creds().apiKeyJp).toBe('sk-jp');
    expect(screen.queryByText(/^Switched to/)).toBeNull();
    expect(document.querySelector('.soniox-key__line')).toHaveTextContent('Belongs to United States');
  });

  it('asks first; confirming moves the region to the key and keeps it as the one key', async () => {
    await pasteJapanKey();
    useRegionChangeStore.getState().answer(true);
    await waitFor(() => expect(region()).toBe('jp'));
    await waitFor(() => expect(creds().apiKey).toBe(''));
    expect(creds().apiKeyJp).toBe('sk-jp');
    expect(await screen.findByRole('status')).toHaveTextContent('Switched to 日本 (Japan): this key works there only.');
    expect(document.querySelector('.soniox-key__line')).toHaveTextContent('Belongs to 日本 (Japan)');
  });
});
