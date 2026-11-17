// Soniox's key, one field, kept by region. The region change here is the real
// path (requestRegionChange → requestSonioxRegionChange), so a custom voice asks before the switch.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: async () => ({ success: true }) }) },
}));
vi.mock('../../providers/soniox/voiceFieldReconcile', () => ({ reconcileSonioxVoiceField: async () => {} }));

import '../../locales';
import { SonioxKeyForm } from './SonioxKeyForm';
import { useProviderStore } from '../../stores/providerStore';
import { useRegionChangeStore } from '../../stores/regionChangeStore';
import { registerRunPhase } from '../../app/runPhase';
import { sonioxProvider } from '../../providers/soniox/provider';
import type { KeyRegions } from '../../providers/soniox/keyRegion';
import type { AnyProvider } from '../../lib/provider/types';

const provider = sonioxProvider as unknown as AnyProvider;
const auth = { signedIn: false, getToken: async () => null };
const settings = () => useProviderStore.getState().entries.soniox!.settings as Record<string, unknown>;
const creds = () => useProviderStore.getState().entries.soniox!.credentials as Record<string, string>;
const line = () => document.querySelector('.soniox-key__line');
const mount = (detect: (key: string) => Promise<KeyRegions>) => render(<SonioxKeyForm provider={provider} auth={auth} disabled={false} detect={detect} />);
const pasteAndSave = (key: string) => {
  fireEvent.change(screen.getByLabelText('API key'), { target: { value: key } });
  fireEvent.click(screen.getByRole('button', { name: 'Save and find its region' }));
};

beforeEach(async () => {
  registerRunPhase(() => 'idle');
  useRegionChangeStore.setState({ question: null });
  useProviderStore.setState({ entries: {}, readiness: {}, selected: 'soniox', selectionLocked: false });
  await useProviderStore.getState().load(sonioxProvider);
  await useProviderStore.getState().updateSettings(sonioxProvider, { region: 'us' });
  // The key's check, answered here and never asked of Soniox: a key that is stored works.
  useProviderStore.setState({
    refreshReadiness: (async () => {
      const r = { state: 'ready', models: [] } as const;
      useProviderStore.setState({ readiness: { ...useProviderStore.getState().readiness, soniox: r } as never });
      return r;
    }) as never,
  });
});
afterEach(() => { cleanup(); useRegionChangeStore.getState().answer(false); });

describe('the Soniox key: one field, by region', () => {
  it('has a single key field, whatever the region and however many regions there are', () => {
    mount(async () => ({ accepted: [], unreachable: [] }));
    expect(document.querySelectorAll('input')).toHaveLength(1);
    expect(screen.getAllByLabelText('API key')).toHaveLength(1);
  });

  it('after the check, a key of the selected region reads "Key works · Belongs to <region>"', async () => {
    mount(async () => ({ accepted: ['us'], unreachable: [] }));
    pasteAndSave('sk-us');
    await waitFor(() => expect(line()).toHaveTextContent('Key works · Belongs to United States'));
    expect(line()).toHaveClass('is-ok');
    expect(creds().apiKey).toBe('sk-us');
  });

  it('a key of another region switches the region at once with a built-in voice, and then reads "Key works"', async () => {
    mount(async () => ({ accepted: ['eu'], unreachable: [] }));
    pasteAndSave('sk-eu');
    await waitFor(() => expect(settings().region).toBe('eu'));
    expect(useRegionChangeStore.getState().question).toBeNull();
    await waitFor(() => expect(line()).toHaveTextContent('Key works · Belongs to European Union'));
    expect(screen.getByRole('status')).toHaveTextContent('Switched to European Union: this key works there only.');
  });

  it('with a custom voice it asks before switching; confirmed, it switches', async () => {
    await useProviderStore.getState().updateSettings(sonioxProvider, { voice: 'uuid-custom-us' });
    mount(async () => ({ accepted: ['jp'], unreachable: [] }));
    pasteAndSave('sk-jp');
    await waitFor(() => expect(useRegionChangeStore.getState().question).toMatchObject({ providerId: 'soniox', managed: false, from: 'us', to: 'jp', warning: { kind: 'built-in' } }));
    // Nothing switched while the question is open.
    expect(settings().region).toBe('us');
    useRegionChangeStore.getState().answer(true);
    await waitFor(() => expect(settings().region).toBe('jp'));
    expect(await screen.findByRole('status')).toHaveTextContent('Switched to 日本 (Japan): this key works there only.');
    await waitFor(() => expect(line()).toHaveTextContent('Key works · Belongs to 日本 (Japan)'));
    expect(creds().apiKeyJp).toBe('sk-jp');
  });

  it('with a custom voice, declining keeps the region and offers the switch', async () => {
    await useProviderStore.getState().updateSettings(sonioxProvider, { voice: 'uuid-custom-us' });
    mount(async () => ({ accepted: ['jp'], unreachable: [] }));
    pasteAndSave('sk-jp');
    await waitFor(() => expect(useRegionChangeStore.getState().question).not.toBeNull());
    useRegionChangeStore.getState().answer(false);
    expect(await screen.findByRole('button', { name: 'Switch to 日本 (Japan)' })).toBeInTheDocument();
    expect(settings().region).toBe('us');
    expect(settings().voice).toBe('uuid-custom-us');
    expect(line()).toHaveTextContent('Key saved · Belongs to 日本 (Japan)');
  });
});
