// B-11 (the owner chose the full version, 2026-11-17): Soniox's key on the accounts page. A key works in one region's
// project only: the page asks every region, keeps the key where it is accepted, shows each region's key, and offers
// to switch when the region selected now has none.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: async () => ({ success: true }) }) },
}));
const change = vi.hoisted(() => ({ calls: [] as Array<{ providerId: string; to: string }> }));
vi.mock('../../lib/region/regionChange', () => ({
  requestRegionChange: async (r: { providerId: string; to: string }) => { change.calls.push({ providerId: r.providerId, to: r.to }); return true; },
}));

import '../../locales';
import { SonioxKeyForm } from './SonioxKeyForm';
import { useProviderStore } from '../../stores/providerStore';
import { presentProviders } from '../../providers/registry';
import type { KeyRegions } from '../../providers/soniox/keyRegion';
import type { AnyProvider } from '../../lib/provider/types';

const soniox = presentProviders().find((p) => p.id === 'soniox') as AnyProvider;
const auth = { signedIn: false, getToken: async () => null };
function given(region: string, credentials: Record<string, string>) {
  useProviderStore.setState({
    selected: 'soniox', selectionLocked: false, readiness: {},
    entries: { soniox: { settings: { region }, credentials: { apiKey: '', apiKeyEu: '', apiKeyJp: '', apiKeyIn: '', ...credentials }, pair: { source: 'ja', target: 'en' } } } as never,
  });
}
const creds = () => useProviderStore.getState().entries.soniox!.credentials as Record<string, string>;
const mount = (detect: (key: string) => Promise<KeyRegions>, disabled = false) =>
  render(<SonioxKeyForm provider={soniox} auth={auth} disabled={disabled} detect={detect} />);
const paste = (key: string) => fireEvent.change(screen.getByLabelText('API key'), { target: { value: key } });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save and find its region' }));

beforeEach(() => {
  change.calls = [];
  vi.spyOn(useProviderStore.getState(), 'refreshReadiness').mockResolvedValue({ state: 'unknown' } as never);
  given('us', {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Soniox's key, by region", () => {
  it("shows every region's key, the selected one marked", () => {
    given('us', { apiKey: 'sk-us', apiKeyJp: 'sk-jp' });
    mount(async () => ({ accepted: [], unreachable: [] }));
    const line = screen.getByRole('list', { name: 'Keys by region' });
    expect(line).toHaveTextContent('United States: key saved, not verified yet (selected)');
    expect(line).toHaveTextContent('European Union: no key');
    expect(line).toHaveTextContent('日本 (Japan): key saved');
    expect(line).toHaveTextContent('India: no key');
  });

  // Rudolf's review: saved is not working. The selected region's key says what its check found.
  it("says whether the selected region's key works, was refused, or is not verified yet", () => {
    given('us', { apiKey: 'sk-us' });
    const line = () => screen.getByRole('list', { name: 'Keys by region' });
    useProviderStore.setState({ readiness: { soniox: { state: 'ready', models: [] } } as never });
    const first = mount(async () => ({ accepted: [], unreachable: [] }));
    expect(line()).toHaveTextContent('United States: key works (selected)');
    first.unmount();
    useProviderStore.setState({ readiness: { soniox: { state: 'not-ready', code: 'auth', reason: 'HTTP 401' } } as never });
    const second = mount(async () => ({ accepted: [], unreachable: [] }));
    expect(line()).toHaveTextContent('United States: key refused (selected)');
    second.unmount();
    useProviderStore.setState({ readiness: { soniox: { state: 'not-ready', code: 'network', reason: 'offline' } } as never });
    mount(async () => ({ accepted: [], unreachable: [] }));
    expect(line()).toHaveTextContent('United States: key saved, not verified yet (selected)');
  });

  it('keeps a key the selected region accepts there, and checks it', async () => {
    const detect = vi.fn(async () => ({ accepted: ['us' as const], unreachable: [] }));
    mount(detect);
    paste('sk-new');
    save();
    await waitFor(() => expect(creds().apiKey).toBe('sk-new'));
    expect(detect).toHaveBeenCalledWith('sk-new');
    expect(screen.getByRole('status')).toHaveTextContent('This key belongs to United States: saved there.');
    expect(useProviderStore.getState().refreshReadiness).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^Switch to/ })).toBeNull();
  });

  it("keeps a key another region accepts in that region's place, and offers to switch to it", async () => {
    mount(async () => ({ accepted: ['jp'], unreachable: [] }));
    paste('sk-jp');
    save();
    await waitFor(() => expect(creds().apiKeyJp).toBe('sk-jp'));
    expect(creds().apiKey).toBe('');
    expect(screen.getByRole('status')).toHaveTextContent('This key belongs to 日本 (Japan): saved there.');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to 日本 (Japan)' }));
    await waitFor(() => expect(change.calls).toEqual([{ providerId: 'soniox', to: 'jp' }]));
  });

  it('keeps no key that no region accepts, and says so', async () => {
    mount(async () => ({ accepted: [], unreachable: [] }));
    paste('not-a-key');
    save();
    expect(await screen.findByRole('status')).toHaveTextContent('No Soniox region accepts this key. Check that it is a Soniox API key.');
    expect(Object.values(creds()).every((v) => v === '')).toBe(true);
  });

  it('keeps the key for the selected region when Soniox cannot be asked, and says so', async () => {
    mount(async () => ({ accepted: [], unreachable: ['us', 'eu', 'jp', 'in'] }));
    paste('sk-maybe');
    save();
    await waitFor(() => expect(creds().apiKey).toBe('sk-maybe'));
    expect(screen.getByRole('status')).toHaveTextContent("Could not ask Soniox which region this key belongs to; saved for United States, the region selected now.");
  });

  it('offers to switch when the selected region has no key and another has', async () => {
    given('eu', { apiKey: 'sk-us' });
    mount(async () => ({ accepted: [], unreachable: [] }));
    expect(screen.getByText('European Union is selected, but your key is for United States.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to United States' }));
    await waitFor(() => expect(change.calls).toEqual([{ providerId: 'soniox', to: 'us' }]));
  });

  // Review (#728): with Save and find its region, emptying the field no longer removes a key; each key is removed
  // from its own region's row.
  it("removes a region's key from its row, and only that one", () => {
    given('us', { apiKey: 'sk-us', apiKeyJp: 'sk-jp' });
    mount(async () => ({ accepted: [], unreachable: [] }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove the key for 日本 (Japan)' }));
    expect(creds().apiKeyJp).toBe('');
    expect(creds().apiKey).toBe('sk-us');
    expect(screen.queryByRole('button', { name: 'Remove the key for European Union' })).toBeNull();
  });

  it("empties the field and checks again when the selected region's key is removed", async () => {
    given('us', { apiKey: 'sk-us' });
    mount(async () => ({ accepted: [], unreachable: [] }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove the key for United States' }));
    expect(creds().apiKey).toBe('');
    expect(screen.getByLabelText('API key')).toHaveValue('');
    await waitFor(() => expect(useProviderStore.getState().refreshReadiness).toHaveBeenCalled());
  });

  // Review (#728): the selected region keeps a refused key, and the new one belongs elsewhere: switching is offered.
  it('offers to switch to the region a new key was kept in, even when the selected region still has a key', async () => {
    given('us', { apiKey: 'sk-refused' });
    mount(async () => ({ accepted: ['eu'], unreachable: [] }));
    paste('sk-eu');
    save();
    await waitFor(() => expect(creds().apiKeyEu).toBe('sk-eu'));
    fireEvent.click(screen.getByRole('button', { name: 'Switch to European Union' }));
    await waitFor(() => expect(change.calls).toEqual([{ providerId: 'soniox', to: 'eu' }]));
  });

  it('shows the selected region\'s key in the field', () => {
    given('jp', { apiKeyJp: 'sk-jp' });
    mount(async () => ({ accepted: [], unreachable: [] }));
    expect(screen.getByLabelText('API key')).toHaveValue('sk-jp');
  });

  it('takes no key during a session', () => {
    mount(async () => ({ accepted: [], unreachable: [] }), true);
    expect(screen.getByLabelText('API key')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save and find its region' })).toBeDisabled();
  });

  it('removes no key during a session', () => {
    given('us', { apiKey: 'sk-us' });
    mount(async () => ({ accepted: [], unreachable: [] }), true);
    expect(screen.getByRole('button', { name: 'Remove the key for United States' })).toBeDisabled();
  });
});
