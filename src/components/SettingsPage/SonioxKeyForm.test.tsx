// Soniox's own key on the accounts page. B-11: a key works in one region's project only, so a pasted key is tried in
// every region. B-39 (the owner, 2026-11-17): the row says only which region the key belongs to — no list of regions,
// no word about the others — the region follows the key, and one key is kept.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: async () => ({ success: true }) }) },
}));
// A region change as the app makes it: the region setting changes (unless `refuse`, as a declined voice question would).
const change = vi.hoisted(() => ({ calls: [] as Array<{ providerId: string; to: string }>, refuse: false }));
vi.mock('../../lib/region/regionChange', () => ({
  requestRegionChange: async (r: { providerId: string; to: string }) => {
    change.calls.push({ providerId: r.providerId, to: r.to });
    if (change.refuse) return false;
    const { useProviderStore: store } = await import('../../stores/providerStore');
    const entries = store.getState().entries as Record<string, { settings: Record<string, unknown> }>;
    store.setState({ entries: { ...entries, soniox: { ...entries.soniox, settings: { ...entries.soniox.settings, region: r.to } } } as never });
    return true;
  },
}));

import '../../locales';
import { SonioxKeyForm } from './SonioxKeyForm';
import { useProviderStore } from '../../stores/providerStore';
import { registerRunPhase } from '../../app/runPhase';
import { presentProviders } from '../../providers/registry';
import type { KeyRegions } from '../../providers/soniox/keyRegion';
import type { AnyProvider } from '../../lib/provider/types';

const soniox = presentProviders().find((p) => p.id === 'soniox') as AnyProvider;
const auth = { signedIn: false, getToken: async () => null };
// The key's check, as the store would run it: answered here, never asked of Soniox; counted.
let checked = 0;
const check = async () => { checked += 1; return { state: 'unknown' }; };
function given(region: string, credentials: Record<string, string>, readiness?: unknown) {
  checked = 0;
  useProviderStore.setState({
    refreshReadiness: check as never,
    selected: 'soniox', selectionLocked: false, readiness: (readiness ? { soniox: readiness } : {}) as never,
    entries: { soniox: { settings: { region }, credentials: { apiKey: '', apiKeyEu: '', apiKeyJp: '', apiKeyIn: '', ...credentials }, pair: { source: 'ja', target: 'en' } } } as never,
  });
}
const creds = () => useProviderStore.getState().entries.soniox!.credentials as Record<string, string>;
const region = () => (useProviderStore.getState().entries.soniox!.settings as { region: string }).region;
const mount = (detect: (key: string) => Promise<KeyRegions>, disabled = false) =>
  render(<SonioxKeyForm provider={soniox} auth={auth} disabled={disabled} detect={detect} />);
const nowhere = async (): Promise<KeyRegions> => ({ accepted: [], unreachable: [] });
const paste = (key: string) => fireEvent.change(screen.getByLabelText('API key'), { target: { value: key } });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save and find its region' }));
const line = () => document.querySelector('.soniox-key__line');

beforeEach(() => {
  change.calls = [];
  change.refuse = false;
  given('us', {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); registerRunPhase(() => 'idle'); });

/** A region search that answers only when the test says so. */
function pending() {
  let answer!: (regions: KeyRegions) => void;
  const detect = () => new Promise<KeyRegions>((resolve) => { answer = resolve; });
  return { detect, answer: (regions: KeyRegions) => answer(regions) };
}
const saveButton = () => screen.findByRole('button', { name: 'Save and find its region' });

describe("Soniox's key and its region", () => {
  it('says what its check found and which region it belongs to, and names no other region', () => {
    given('jp', { apiKeyJp: 'sk-jp' }, { state: 'ready', models: [] });
    mount(nowhere);
    expect(line()).toHaveTextContent('Key works · Belongs to 日本 (Japan)');
    expect(screen.queryByRole('list')).toBeNull();
    for (const other of ['United States', 'European Union', 'India']) expect(document.body).not.toHaveTextContent(other);
  });

  it('says a refused key is refused, and a key not checked yet is not verified', () => {
    given('us', { apiKey: 'sk-us' }, { state: 'not-ready', code: 'auth', reason: 'HTTP 401' });
    const { unmount } = mount(nowhere);
    expect(line()).toHaveTextContent('Key refused · Belongs to United States');
    unmount();
    given('us', { apiKey: 'sk-us' });
    mount(nowhere);
    expect(line()).toHaveTextContent('Key saved, not verified yet · Belongs to United States');
  });

  it('says nothing about a region when there is no key', () => {
    mount(nowhere);
    expect(line()).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
  });

  it("keeps a key the selected region accepts there, as the one key, and checks it", async () => {
    given('us', { apiKeyJp: 'sk-old-jp' });
    const detect = vi.fn(async () => ({ accepted: ['us' as const], unreachable: [] }));
    mount(detect);
    paste('sk-new');
    save();
    await waitFor(() => expect(creds().apiKey).toBe('sk-new'));
    expect(detect).toHaveBeenCalledWith('sk-new');
    expect(creds().apiKeyJp).toBe('');
    expect(change.calls).toEqual([]);
    await waitFor(() => expect(checked).toBeGreaterThan(0));
  });

  it("switches to the region a key belongs to, keeps it there as the one key, and says so", async () => {
    given('us', { apiKey: 'sk-refused' });
    mount(async () => ({ accepted: ['jp'], unreachable: [] }));
    paste('sk-jp');
    save();
    await waitFor(() => expect(creds().apiKeyJp).toBe('sk-jp'));
    expect(creds().apiKey).toBe('');
    await waitFor(() => expect(region()).toBe('jp'));
    expect(change.calls).toEqual([{ providerId: 'soniox', to: 'jp' }]);
    expect(await screen.findByRole('status')).toHaveTextContent('Switched to 日本 (Japan): this key works there only.');
    expect(line()).toHaveTextContent('Belongs to 日本 (Japan)');
    expect(screen.getByLabelText('API key')).toHaveValue('sk-jp');
    await waitFor(() => expect(checked).toBeGreaterThan(0));
  });

  it("offers the switch when the region could not be changed (a voice question declined)", async () => {
    change.refuse = true;
    mount(async () => ({ accepted: ['jp'], unreachable: [] }));
    paste('sk-jp');
    save();
    await waitFor(() => expect(creds().apiKeyJp).toBe('sk-jp'));
    expect(region()).toBe('us');
    expect(line()).toHaveTextContent('Key saved · Belongs to 日本 (Japan)');
    change.refuse = false;
    fireEvent.click(await screen.findByRole('button', { name: 'Switch to 日本 (Japan)' }));
    await waitFor(() => expect(region()).toBe('jp'));
  });

  it("keeps the selected region's working key when the switch to the new key's region is declined", async () => {
    change.refuse = true;
    given('us', { apiKey: 'sk-us' }, { state: 'ready', models: [] });
    mount(async () => ({ accepted: ['jp'], unreachable: [] }));
    paste('sk-jp');
    save();
    await waitFor(() => expect(creds().apiKeyJp).toBe('sk-jp'));
    expect(change.calls).toEqual([{ providerId: 'soniox', to: 'jp' }]);
    expect(region()).toBe('us');
    expect(creds().apiKey).toBe('sk-us');
    await waitFor(() => expect(checked).toBeGreaterThan(0));
  });

  it('empties a key stored for another region while this one was being placed', async () => {
    const search = pending();
    mount(search.detect);
    paste('sk-us');
    save();
    const entry = useProviderStore.getState().entries.soniox!;
    useProviderStore.setState({ entries: { soniox: { ...entry, credentials: { ...entry.credentials, apiKeyEu: 'sk-eu' } } } as never });
    search.answer({ accepted: ['us'], unreachable: [] });
    await waitFor(() => expect(creds().apiKey).toBe('sk-us'));
    expect(creds().apiKeyEu).toBe('');
  });

  it('stores nothing when the region was changed while the key was being placed', async () => {
    given('us', { apiKeyEu: 'sk-eu' });
    const search = pending();
    mount(search.detect);
    paste('sk-us');
    save();
    const entry = useProviderStore.getState().entries.soniox!;
    useProviderStore.setState({ entries: { soniox: { ...entry, settings: { ...(entry.settings as object), region: 'eu' } } } as never });
    search.answer({ accepted: ['us'], unreachable: [] });
    await saveButton();
    expect(creds().apiKeyEu).toBe('sk-eu');
    expect(creds().apiKey).toBe('');
    expect(checked).toBe(0);
  });

  it('stores nothing when a session started while the region was being found', async () => {
    given('us', { apiKeyJp: 'sk-old-jp' });
    const search = pending();
    mount(search.detect);
    paste('sk-new');
    save();
    registerRunPhase(() => 'running');
    search.answer({ accepted: ['us'], unreachable: [] });
    await saveButton();
    expect(creds().apiKey).toBe('');
    expect(creds().apiKeyJp).toBe('sk-old-jp');
    expect(checked).toBe(0);
  });

  it('keeps no key that no region accepts, and says so', async () => {
    given('us', { apiKey: 'sk-us' });
    mount(nowhere);
    paste('not-a-key');
    save();
    expect(await screen.findByRole('status')).toHaveTextContent('No Soniox region accepts this key. Check that it is a Soniox API key.');
    expect(creds().apiKey).toBe('sk-us');
  });

  it("keeps the key for the selected region when Soniox cannot be asked, removes no other region's key, and says so", async () => {
    given('us', { apiKeyJp: 'sk-old-jp' });
    mount(async () => ({ accepted: [], unreachable: ['us', 'eu', 'jp', 'in'] }));
    paste('sk-maybe');
    save();
    await waitFor(() => expect(creds().apiKey).toBe('sk-maybe'));
    // Nothing vouched for the new key: a key kept for another region may be the one that works.
    expect(creds().apiKeyJp).toBe('sk-old-jp');
    expect(screen.getByRole('status')).toHaveTextContent('Could not ask Soniox which region this key belongs to; saved for United States, the region selected now.');
  });

  it('removes the key, empties the field and checks again', async () => {
    given('jp', { apiKeyJp: 'sk-jp' });
    mount(nowhere);
    fireEvent.click(screen.getByRole('button', { name: 'Remove the key for 日本 (Japan)' }));
    expect(creds().apiKeyJp).toBe('');
    expect(screen.getByLabelText('API key')).toHaveValue('');
    expect(line()).toBeNull();
    await waitFor(() => expect(checked).toBeGreaterThan(0));
  });

  it("shows a key kept for another region before (an older version), with the switch to it", async () => {
    given('eu', { apiKey: 'sk-us' });
    mount(nowhere);
    expect(screen.getByLabelText('API key')).toHaveValue('sk-us');
    expect(line()).toHaveTextContent('Key saved · Belongs to United States');
    expect(document.body).not.toHaveTextContent('European Union');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to United States' }));
    await waitFor(() => expect(change.calls).toEqual([{ providerId: 'soniox', to: 'us' }]));
  });

  it('takes no key and removes none during a session', () => {
    given('us', { apiKey: 'sk-us' });
    mount(nowhere, true);
    expect(screen.getByLabelText('API key')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save and find its region' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove the key for United States' })).toBeDisabled();
  });
});
