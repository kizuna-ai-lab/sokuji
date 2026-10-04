// src/components/CaptionShare/CaptionSharePanel.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { IDLE_STATUS, useCaptionShareStore } from '../../stores/captionShareStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
const trackEvent = vi.fn();
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent }) }));
const controller = {
  start: vi.fn(async () => {
    useCaptionShareStore.getState().markStarted(Date.now(), RUNNING);
    return true;
  }),
  stop: vi.fn(async () => { useCaptionShareStore.getState().markStopped(); }),
  selectAddress: vi.fn(async () => {}),
  setAllowSave: vi.fn(),
  setWifiHint: vi.fn(),
  openPresent: vi.fn(async () => {}),
};
vi.mock('../../app/captionShare', () => ({ getCaptionShareController: () => controller }));

import CaptionSharePanel, { NO_VIEWERS_WARNING_MS } from './CaptionSharePanel';

const RUNNING = {
  ...IDLE_STATUS, running: true, port: 7788, selected: '192.168.1.23', viewers: 0,
  addresses: [{ address: '192.168.1.23', label: 'wlan0', kind: 'wifi' as const }],
};

beforeEach(() => {
  vi.clearAllMocks();
  useCaptionShareStore.getState().markStopped();
  useCaptionShareStore.setState({ allowSave: false, wifiHint: { enabled: false, ssid: '', password: '' }, error: null, busy: false, firewallNoteSeen: false });
  (window as unknown as { electron?: unknown }).electron = { osInfo: { platform: 'linux' } };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('CaptionSharePanel', () => {
  it('off: explains, offers the switch, and tracks a successful start with the address kind', async () => {
    render(<CaptionSharePanel />);
    expect(screen.getByText('captionShare.intro')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('switch')); });
    expect(controller.start).toHaveBeenCalled();
    expect(trackEvent).toHaveBeenCalledWith('caption_share_started', { address_kind: 'wifi' });
  });

  it('shows the firewall note on Windows only, until a start succeeded', () => {
    (window as unknown as { electron: unknown }).electron = { osInfo: { platform: 'win32' } };
    const { rerender } = render(<CaptionSharePanel />);
    expect(screen.getByText('captionShare.firewallNote')).toBeTruthy();
    act(() => { useCaptionShareStore.setState({ firewallNoteSeen: true }); });
    rerender(<CaptionSharePanel />);
    expect(screen.queryByText('captionShare.firewallNote')).toBeNull();
  });

  it('shows why a start failed', () => {
    useCaptionShareStore.setState({ error: { code: 'ports-busy', reason: '' } });
    render(<CaptionSharePanel />);
    expect(screen.getByText('captionShare.errorPortsBusy')).toBeTruthy();
  });

  it('on: QR code and address, no network dropdown for one address, one for several', () => {
    useCaptionShareStore.getState().markStarted(Date.now(), RUNNING);
    const { rerender } = render(<CaptionSharePanel />);
    expect(screen.getByRole('img', { name: 'http://192.168.1.23:7788/' })).toBeTruthy();
    expect(screen.getByText('http://192.168.1.23:7788/')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    act(() => {
      useCaptionShareStore.getState().setStatus({ ...RUNNING, addresses: [...RUNNING.addresses, { address: '172.17.0.1', label: 'docker0', kind: 'virtual' }] });
    });
    rerender(<CaptionSharePanel />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '172.17.0.1' } });
    expect(controller.selectAddress).toHaveBeenCalledWith('172.17.0.1');
  });

  it('asks for the Wi-Fi fields only when the hint is on, and toggles saving', () => {
    useCaptionShareStore.getState().markStarted(Date.now(), RUNNING);
    const { rerender } = render(<CaptionSharePanel />);
    expect(screen.queryByPlaceholderText('captionShare.wifiNamePlaceholder')).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'captionShare.allowSave' }));
    expect(controller.setAllowSave).toHaveBeenCalledWith(true);
    act(() => { useCaptionShareStore.setState({ wifiHint: { enabled: true, ssid: '', password: '' } }); });
    rerender(<CaptionSharePanel />);
    fireEvent.change(screen.getByPlaceholderText('captionShare.wifiNamePlaceholder'), { target: { value: 'Guest' } });
    expect(controller.setWifiHint).toHaveBeenCalledWith({ ssid: 'Guest' });
  });

  it('warns after two minutes with nobody connected, and not once someone did', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    useCaptionShareStore.getState().markStarted(1_000_000, RUNNING);
    render(<CaptionSharePanel />);
    expect(screen.queryByText('captionShare.warnNoViewers')).toBeNull();
    act(() => { vi.advanceTimersByTime(NO_VIEWERS_WARNING_MS + 1); });
    expect(screen.getByText('captionShare.warnNoViewers')).toBeTruthy();
    act(() => { useCaptionShareStore.getState().setStatus({ ...RUNNING, viewers: 1 }); });
    expect(screen.queryByText('captionShare.warnNoViewers')).toBeNull();
  });

  it('stopping tracks the duration and the peak, then stops', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    useCaptionShareStore.getState().markStarted(4_000, { ...RUNNING, viewers: 5 });
    render(<CaptionSharePanel />);
    await act(async () => { fireEvent.click(screen.getByText('captionShare.stop')); });
    expect(trackEvent).toHaveBeenCalledWith('caption_share_ended', { duration_ms: 6_000, peak_viewers: 5 });
    expect(controller.stop).toHaveBeenCalled();
  });

  // A stop that did not go through leaves sharing on (PR #597 review): the
  // share has not ended, and the next stop must not count a second ending.
  it('does not track an ending when the stop did not go through', async () => {
    useCaptionShareStore.getState().markStarted(4_000, { ...RUNNING, viewers: 5 });
    controller.stop.mockImplementationOnce(async () => {});
    render(<CaptionSharePanel />);
    await act(async () => { fireEvent.click(screen.getByText('captionShare.stop')); });
    expect(trackEvent).not.toHaveBeenCalledWith('caption_share_ended', expect.anything());
  });
});
