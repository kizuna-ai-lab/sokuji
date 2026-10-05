// src/components/Banner/useBanners.test.tsx
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Banners } from './useBanners';
import useAudioSystemStore from '../../stores/audioSystemStore';
import useUpdateStore from '../../stores/updateStore';

// t(key) renders the key itself, so these assertions pin which keys the
// banners use, not their English copy.
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
afterEach(cleanup);

const unavailable = (reason: string, extra: Record<string, unknown> = {}) =>
  useAudioSystemStore.setState({
    status: 'unavailable', platform: reason === 'mac-driver-not-loaded' ? 'darwin' : 'linux',
    reason: reason as never, message: null, dismissed: false, retrying: false, repairing: false, repairFailed: false, ...extra,
  });
const update = (extra: Partial<ReturnType<typeof useUpdateStore.getState>>) =>
  useUpdateStore.setState({ status: 'idle', newVersion: '0.43.0', downloadProgress: 0, errorMessage: null, errorFrom: null, supportsAutoUpdate: true, bannerDismissed: false, ...extra });

beforeEach(() => {
  useAudioSystemStore.setState({ status: 'ok', dismissed: false, retry: vi.fn(async () => {}), repair: vi.fn(async () => {}) });
  update({ downloadUpdate: vi.fn(), installUpdate: vi.fn(), openDialog: vi.fn(), dismissBanner: vi.fn() });
});

describe('Banners — the audio system (today’s AudioSystemBanner cases)', () => {
  it('offers a repair, not a retry, for a macOS driver that was never loaded', () => {
    unavailable('mac-driver-not-loaded');
    render(<Banners />);
    expect(screen.getByText('audioSystem.macDriverNotLoadedBody')).toBeTruthy();
    expect(screen.queryByText('audioSystem.retry')).toBeNull();
    fireEvent.click(screen.getByText('audioSystem.repair'));
    expect(useAudioSystemStore.getState().repair).toHaveBeenCalledWith('audioSystem.macRepairPrompt');
  });
  it('says so when the repair did not bring the device back', () => {
    unavailable('mac-driver-not-loaded', { repairFailed: true });
    render(<Banners />);
    expect(screen.getByText('audioSystem.macRepairFailedBody')).toBeTruthy();
  });
  it('disables the button while the repair runs', () => {
    unavailable('mac-driver-not-loaded', { repairing: true });
    render(<Banners />);
    expect((screen.getByText('audioSystem.repairing').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });
  it('keeps the retry for the other reasons, and the command for a missing pactl', () => {
    unavailable('pulseaudio-unavailable');
    const { unmount } = render(<Banners />);
    fireEvent.click(screen.getByText('audioSystem.retry'));
    expect(useAudioSystemStore.getState().retry).toHaveBeenCalled();
    unmount();
    unavailable('pactl-missing');
    const { container } = render(<Banners />);
    expect(container.querySelector('.banner__code')?.textContent).toBe('audioSystem.installCommand');
  });
  it('is attention-toned, dismissible, and gone once dismissed', () => {
    unavailable('pulseaudio-unavailable');
    const { container } = render(<Banners />);
    expect(container.querySelector('.banner--attention')).not.toBeNull();
    fireEvent.click(container.querySelector('.banner__dismiss')!);
    expect(useAudioSystemStore.getState().dismissed).toBe(true);
  });
});

describe('Banners — the update (spec 2026-10-05 §4)', () => {
  it('available: brand tone, update.available, Download Now starts the download, dismissible', () => {
    update({ status: 'available' });
    const { container } = render(<Banners />);
    expect(container.querySelector('.banner--brand')).not.toBeNull();
    expect(screen.getByText('update.available')).toBeTruthy();
    fireEvent.click(screen.getByText('update.downloadNow'));
    expect(useUpdateStore.getState().downloadUpdate).toHaveBeenCalled();
    fireEvent.click(container.querySelector('.banner__dismiss')!);
    expect(useUpdateStore.getState().dismissBanner).toHaveBeenCalled();
  });
  it('available without auto-update: the Linux title and Go to Download opens the dialog', () => {
    update({ status: 'available', supportsAutoUpdate: false });
    render(<Banners />);
    expect(screen.getByText('update.linuxMigrateTitle')).toBeTruthy();
    fireEvent.click(screen.getByText('update.goToDownload'));
    expect(useUpdateStore.getState().openDialog).toHaveBeenCalled();
  });
  it('downloading: progress, no action, no dismiss', () => {
    update({ status: 'downloading', downloadProgress: 37 });
    const { container } = render(<Banners />);
    expect(screen.getByText('update.downloading')).toBeTruthy();
    expect((container.querySelector('.banner__progress-fill') as HTMLElement).style.width).toBe('37%');
    expect(container.querySelector('.banner__btn')).toBeNull();
    expect(container.querySelector('.banner__dismiss')).toBeNull();
  });
  it('downloaded: Restart and Update installs', () => {
    update({ status: 'downloaded' });
    render(<Banners />);
    fireEvent.click(screen.getByText('update.restartNow'));
    expect(useUpdateStore.getState().installUpdate).toHaveBeenCalled();
  });
  // Spec §4's table: only `downloading` cannot be dismissed; the next `available` re-arms (the store's reset).
  it('a dismissed banner stays hidden except while downloading', () => {
    update({ status: 'available', bannerDismissed: true });
    expect(render(<Banners />).container.querySelector('.banner')).toBeNull();
    cleanup();
    update({ status: 'downloaded', bannerDismissed: true });
    expect(render(<Banners />).container.querySelector('.banner')).toBeNull();
    cleanup();
    update({ status: 'downloading', bannerDismissed: true });
    expect(render(<Banners />).container.querySelector('.banner')).not.toBeNull();
  });
  it('downloaded: the X dismisses it', () => {
    update({ status: 'downloaded' });
    const { container } = render(<Banners />);
    fireEvent.click(container.querySelector('.banner__dismiss')!);
    expect(useUpdateStore.getState().dismissBanner).toHaveBeenCalled();
  });
  // Ruling 9: no error banner, but a failure keeps a way back. A download that failed is
  // `available` again (Download Now is the retry); an install that failed keeps `downloaded`.
  it('an error while downloading draws the available banner again, with Download Now', () => {
    update({ status: 'error', errorFrom: 'downloading', errorMessage: 'net::ERR' });
    const { container } = render(<Banners />);
    expect(container.querySelector('.banner--brand')).not.toBeNull();
    expect(screen.getByText('update.available')).toBeTruthy();
    fireEvent.click(screen.getByText('update.downloadNow'));
    expect(useUpdateStore.getState().downloadUpdate).toHaveBeenCalled();
  });
  it('an error while downloaded keeps the downloaded banner, with Restart and Update', () => {
    update({ status: 'error', errorFrom: 'downloaded', errorMessage: 'install failed' });
    render(<Banners />);
    expect(screen.getByText('update.downloaded')).toBeTruthy();
    fireEvent.click(screen.getByText('update.restartNow'));
    expect(useUpdateStore.getState().installUpdate).toHaveBeenCalled();
  });
  it('an error while checking draws nothing, and no error banner ever', () => {
    update({ status: 'error', errorFrom: 'checking' });
    const { container } = render(<Banners />);
    expect(container.querySelector('.banner')).toBeNull();
  });
  it('error, idle, checking and not-available draw nothing', () => {
    for (const status of ['error', 'idle', 'checking', 'not-available'] as const) {
      update({ status });
      expect(render(<Banners />).container.querySelector('.banner'), status).toBeNull();
      cleanup();
    }
  });
  it('attention sits above brand', () => {
    unavailable('pulseaudio-unavailable');
    update({ status: 'available' });
    const { container } = render(<Banners />);
    const tones = Array.from(container.querySelectorAll('.banner')).map((el) => el.className);
    expect(tones).toEqual(['banner banner--attention', 'banner banner--brand']);
  });
});
