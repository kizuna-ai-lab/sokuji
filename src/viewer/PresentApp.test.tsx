// src/viewer/PresentApp.test.tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import PresentApp from './PresentApp';

class FakeEventSource {
  static last: FakeEventSource | null = null;
  listeners = new Map<string, (e: { data: string }) => void>();
  closed = false;
  constructor(public url: string) { FakeEventSource.last = this; }
  addEventListener(type: string, fn: (e: { data: string }) => void) { this.listeners.set(type, fn); }
  close() { this.closed = true; }
  emit(type: string, data: unknown) { this.listeners.get(type)?.({ data: JSON.stringify(data) }); }
}

const INFO = { url: 'http://192.168.1.23:7788/', pair: { source: 'ja', target: 'zh-CN' }, phase: 'live', viewers: 12, wifi: null };

beforeEach(() => {
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true });
});
afterEach(cleanup);

describe('PresentApp', () => {
  it('shows the address large, the QR code, the count, and no Wi-Fi step without a hint', () => {
    render(<PresentApp />);
    expect(FakeEventSource.last?.url).toBe('/present/events');
    act(() => FakeEventSource.last!.emit('present', INFO));
    expect(screen.getByText('http://192.168.1.23:7788/')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'http://192.168.1.23:7788/' })).toBeTruthy();
    expect(screen.getByText('Watching: 12')).toBeTruthy();
    expect(screen.queryByText(/^Join the Wi/)).toBeNull();
    expect(document.title).toBe('Sokuji projector page');
  });

  // His live test 2026-10-05: Chrome on Android cannot reach a LAN address
  // until the "Nearby devices" permission is allowed, and the viewer page never
  // loads to say so; the room reads it here before scanning.
  it('tells Android Chrome users which permission opens the page', () => {
    render(<PresentApp />);
    act(() => FakeEventSource.last!.emit('present', INFO));
    expect(screen.getByText(/Chrome .*Nearby devices/)).toBeTruthy();
  });

  it("speaks the host's UI language from the address, over the window's OS locale", () => {
    window.history.pushState({}, '', '/present?lang=ja');
    render(<PresentApp />);
    act(() => FakeEventSource.last!.emit('present', INFO));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('お手元のスマートフォンやパソコンで字幕をご覧ください');
    window.history.pushState({}, '', '/present');
  });

  it('leaves the pair out until the host has one', () => {
    render(<PresentApp />);
    act(() => FakeEventSource.last!.emit('present', { ...INFO, pair: { source: '', target: '' } }));
    expect(screen.getByText('No app, no sign-in')).toBeTruthy();
    act(() => FakeEventSource.last!.emit('present', INFO));
    expect(screen.getByText('Japanese ⇄ Chinese (China) · No app, no sign-in')).toBeTruthy();
  });

  it('adds the Wi-Fi step with name, password and its own QR code', () => {
    render(<PresentApp />);
    act(() => FakeEventSource.last!.emit('present', { ...INFO, wifi: { ssid: 'Meetup-Guest', password: 'pw' } }));
    expect(screen.getByText(/^Join the Wi/)).toBeTruthy();
    expect(screen.getByText('Meetup-Guest')).toBeTruthy();
    expect(screen.getByText('Password: pw')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Meetup-Guest' })).toBeTruthy();
  });

  it('says sharing has ended and stops listening', () => {
    render(<PresentApp />);
    act(() => FakeEventSource.last!.emit('ended', {}));
    expect(screen.getByText('Sharing has ended')).toBeTruthy();
    expect(FakeEventSource.last!.closed).toBe(true);
  });
});
