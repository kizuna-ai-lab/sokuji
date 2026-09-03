/**
 * Tests for SlotDeviceBadge — the Engine page's read-only per-slot
 * compute-device badge drawn inside the slot's select (B'2 decision,
 * 2026-09-03): the setting in bold plus the resolved actual device once
 * known, amber-outlined when pinned; informational only, never a control.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { SlotDeviceBadge } from './SlotDeviceBadge';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string, options?: Record<string, string>) => {
      if (!options) return defaultValue ?? key;
      let result = defaultValue ?? key;
      for (const [k, v] of Object.entries(options)) result = result.replace(`{{${k}}}`, v);
      return result;
    },
  }),
}));

type DeviceSetting = 'auto' | 'cpu' | 'gpu';
let mockSettings: { asrDevice: DeviceSetting; translationDevice: DeviceSetting; ttsDevice: DeviceSetting } = {
  asrDevice: 'auto', translationDevice: 'auto', ttsDevice: 'auto',
};
type Resolved = { model: string; device: string } | null;
let mockAsrResolved: Resolved = null;
let mockTranslationResolved: Resolved = null;
let mockTtsResolved: Resolved = null;
// One catalog entry with an available accelerator tier = "this box has a GPU".
const GPU_CATALOG = { m: { tiers: [{ tier: 'gpu-vulkan', available: true }] } };
const CPU_CATALOG = { m: { tiers: [{ tier: 'cpu', available: true }] } };
let mockCatalog: Record<string, unknown> = GPU_CATALOG;

vi.mock('../../../stores/settingsStore', () => ({
  useLocalNativeSettings: () => mockSettings,
}));

vi.mock('../../../stores/nativeModelStore', () => ({
  useNativeAsrResolved: () => mockAsrResolved,
  useNativeTranslationResolved: () => mockTranslationResolved,
  useNativeTtsResolved: () => mockTtsResolved,
  useNativeCatalog: () => mockCatalog,
}));

beforeEach(() => {
  mockSettings = { asrDevice: 'auto', translationDevice: 'auto', ttsDevice: 'auto' };
  mockAsrResolved = null;
  mockTranslationResolved = null;
  mockTtsResolved = null;
  mockCatalog = GPU_CATALOG;
});

const badge = (container: HTMLElement): HTMLElement => {
  const el = container.querySelector('.slot-device-badge');
  if (!el) throw new Error('no badge rendered');
  return el as HTMLElement;
};

describe('SlotDeviceBadge', () => {
  it('is a plain span, not a control: nothing to click, nothing to focus', () => {
    const { container } = render(<SlotDeviceBadge stage="asr" />);
    expect(badge(container).tagName).toBe('SPAN');
    expect(container.querySelector('button')).toBeNull();
  });

  it('publishes its width to the host element as --slot-badge-w and clears it on unmount', () => {
    const { container, unmount } = render(<div><SlotDeviceBadge stage="asr" /></div>);
    const host = badge(container).parentElement!;
    expect(host.style.getPropertyValue('--slot-badge-w')).toMatch(/^\d+px$/);
    unmount();
    expect(host.style.getPropertyValue('--slot-badge-w')).toBe('');
  });

  it('auto without a resolved device shows only "Auto"', () => {
    const { container } = render(<SlotDeviceBadge stage="asr" />);
    const btn = badge(container);
    expect(btn).toHaveTextContent('Auto');
    expect(btn.querySelector('span')).toBeNull();
    expect(btn.className).not.toContain('--pinned');
  });

  it('auto with a resolved vulkan device shows "Auto" and "Vulkan"', () => {
    mockAsrResolved = { model: 'm', device: 'vulkan' };
    const { container } = render(<SlotDeviceBadge stage="asr" />);
    const btn = badge(container);
    expect(btn.querySelector('b')).toHaveTextContent('Auto');
    expect(btn.querySelector('span')).toHaveTextContent('Vulkan');
  });

  it('a pinned cpu setting with a resolved cpu device shows both words and the --pinned class', () => {
    mockSettings = { ...mockSettings, translationDevice: 'cpu' };
    mockTranslationResolved = { model: 'm', device: 'cpu' };
    const { container } = render(<SlotDeviceBadge stage="translation" />);
    const btn = badge(container);
    expect(btn.querySelector('b')).toHaveTextContent('CPU');
    expect(btn.querySelector('span')).toHaveTextContent('CPU');
    expect(btn.className).toContain('slot-device-badge--pinned');
  });

  it('a pinned gpu setting shows "GPU" pinned while a GPU tier exists', () => {
    mockSettings = { ...mockSettings, asrDevice: 'gpu' };
    const { container } = render(<SlotDeviceBadge stage="asr" />);
    const btn = badge(container);
    expect(btn.querySelector('b')).toHaveTextContent('GPU');
    expect(btn.className).toContain('slot-device-badge--pinned');
  });

  it('a stale gpu pin on a box with no GPU tier reads as Auto, unpinned — the same coercion the library control applies', () => {
    mockSettings = { ...mockSettings, asrDevice: 'gpu' };
    mockCatalog = CPU_CATALOG;
    const { container } = render(<SlotDeviceBadge stage="asr" />);
    const btn = badge(container);
    expect(btn.querySelector('b')).toHaveTextContent('Auto');
    expect(btn.className).not.toContain('--pinned');
  });

  it('a resolved metal device maps to "Metal"', () => {
    mockTtsResolved = { model: 'm', device: 'metal' };
    const { container } = render(<SlotDeviceBadge stage="tts" />);
    expect(badge(container).querySelector('span')).toHaveTextContent('Metal');
  });



});
