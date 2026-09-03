/**
 * Tests for SlotDeviceBadge — the Engine page's read-only per-slot
 * compute-device badge (B'2 decision, 2026-09-03): the setting in bold plus
 * the resolved actual device once known, amber-outlined when pinned, opening
 * the slot's library page on click.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

describe('SlotDeviceBadge', () => {
  it('auto without a resolved device shows only "Auto"', () => {
    render(<SlotDeviceBadge stage="asr" onOpen={vi.fn()} />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveTextContent('Auto');
    expect(btn.querySelector('span')).toBeNull();
    expect(btn.className).not.toContain('--pinned');
  });

  it('auto with a resolved vulkan device shows "Auto" and "Vulkan"', () => {
    mockAsrResolved = { model: 'm', device: 'vulkan' };
    render(<SlotDeviceBadge stage="asr" onOpen={vi.fn()} />);
    const btn = screen.getByRole('button');
    expect(btn.querySelector('b')).toHaveTextContent('Auto');
    expect(btn.querySelector('span')).toHaveTextContent('Vulkan');
  });

  it('a pinned cpu setting with a resolved cpu device shows both words and the --pinned class', () => {
    mockSettings = { ...mockSettings, translationDevice: 'cpu' };
    mockTranslationResolved = { model: 'm', device: 'cpu' };
    render(<SlotDeviceBadge stage="translation" onOpen={vi.fn()} />);
    const btn = screen.getByRole('button');
    expect(btn.querySelector('b')).toHaveTextContent('CPU');
    expect(btn.querySelector('span')).toHaveTextContent('CPU');
    expect(btn.className).toContain('slot-device-badge--pinned');
  });

  it('a pinned gpu setting shows "GPU" pinned while a GPU tier exists', () => {
    mockSettings = { ...mockSettings, asrDevice: 'gpu' };
    render(<SlotDeviceBadge stage="asr" onOpen={vi.fn()} />);
    const btn = screen.getByRole('button');
    expect(btn.querySelector('b')).toHaveTextContent('GPU');
    expect(btn.className).toContain('slot-device-badge--pinned');
  });

  it('a stale gpu pin on a box with no GPU tier reads as Auto, unpinned — the same coercion the library control applies', () => {
    mockSettings = { ...mockSettings, asrDevice: 'gpu' };
    mockCatalog = CPU_CATALOG;
    render(<SlotDeviceBadge stage="asr" onOpen={vi.fn()} />);
    const btn = screen.getByRole('button');
    expect(btn.querySelector('b')).toHaveTextContent('Auto');
    expect(btn.className).not.toContain('--pinned');
  });

  it('a resolved metal device maps to "Metal"', () => {
    mockTtsResolved = { model: 'm', device: 'metal' };
    render(<SlotDeviceBadge stage="tts" onOpen={vi.fn()} />);
    expect(screen.getByRole('button').querySelector('span')).toHaveTextContent('Metal');
  });

  it('clicking the badge calls onOpen', () => {
    const onOpen = vi.fn();
    render(<SlotDeviceBadge stage="asr" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('composes the title from the setting and the actual device', () => {
    mockAsrResolved = { model: 'm', device: 'vulkan' };
    render(<SlotDeviceBadge stage="asr" onOpen={vi.fn()} />);
    expect(screen.getByRole('button').title).toBe(
      'Compute device: Auto → Vulkan — change it in the library');
  });

  it('composes the title without an actual device when nothing has resolved yet', () => {
    render(<SlotDeviceBadge stage="asr" onOpen={vi.fn()} />);
    expect(screen.getByRole('button').title).toBe(
      'Compute device: Auto — change it in the library');
  });
});
