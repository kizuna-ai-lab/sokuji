/**
 * Tests for SlotDeviceBadge — the Engine page's read-only per-slot
 * compute-device badge drawn inside the slot's select (B'2 decision,
 * 2026-09-03): the setting in bold plus the resolved actual device once
 * known, amber-outlined when pinned; informational only, never a control.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { SlotDeviceBadge } from './SlotDeviceBadge';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) => defaultValue ?? key,
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
const setting = (container: HTMLElement) => badge(container).querySelector('.slot-device-badge__setting');
const actual = (container: HTMLElement) => badge(container).querySelector('.slot-device-badge__actual');

describe('SlotDeviceBadge', () => {
  it('is a plain span, not a control: nothing to click, nothing to focus', () => {
    const { container } = render(<SlotDeviceBadge stage="asr" modelId="m" id="b" />);
    expect(badge(container).tagName).toBe('SPAN');
    expect(container.querySelector('button')).toBeNull();
  });

  it('carries the id the select describes itself by, and names what it is for assistive tech', () => {
    const { container } = render(<SlotDeviceBadge stage="asr" modelId="m" id="slot-asr-0" />);
    expect(badge(container).id).toBe('slot-asr-0');
    expect(badge(container).querySelector('.slot-device-badge__sr')).toHaveTextContent('Compute device:');
    expect(badge(container).textContent).toBe('Compute device: Auto');
  });

  it('auto without a resolved device shows only "Auto"', () => {
    const { container } = render(<SlotDeviceBadge stage="asr" modelId="m" id="b" />);
    expect(setting(container)).toHaveTextContent('Auto');
    expect(actual(container)).toBeNull();
    expect(badge(container).className).not.toContain('--pinned');
  });

  it('auto with this model resolved on vulkan shows "Auto" and "Vulkan"', () => {
    mockAsrResolved = { model: 'm', device: 'vulkan' };
    const { container } = render(<SlotDeviceBadge stage="asr" modelId="m" id="b" />);
    expect(setting(container)).toHaveTextContent('Auto');
    expect(actual(container)).toHaveTextContent('Vulkan');
  });

  it('a pinned cpu setting with this model resolved on cpu shows both words and the --pinned class', () => {
    mockSettings = { ...mockSettings, translationDevice: 'cpu' };
    mockTranslationResolved = { model: 'm', device: 'cpu' };
    const { container } = render(<SlotDeviceBadge stage="translation" modelId="m" id="b" />);
    expect(setting(container)).toHaveTextContent('CPU');
    expect(actual(container)).toHaveTextContent('CPU');
    expect(badge(container).className).toContain('slot-device-badge--pinned');
  });

  it('a pinned gpu setting shows "GPU" pinned while a GPU tier exists', () => {
    mockSettings = { ...mockSettings, asrDevice: 'gpu' };
    const { container } = render(<SlotDeviceBadge stage="asr" modelId="m" id="b" />);
    expect(setting(container)).toHaveTextContent('GPU');
    expect(badge(container).className).toContain('slot-device-badge--pinned');
  });

  it('a stale gpu pin on a box with no GPU tier reads as Auto, unpinned — the same coercion the library control applies', () => {
    mockSettings = { ...mockSettings, asrDevice: 'gpu' };
    mockCatalog = CPU_CATALOG;
    const { container } = render(<SlotDeviceBadge stage="asr" modelId="m" id="b" />);
    expect(setting(container)).toHaveTextContent('Auto');
    expect(badge(container).className).not.toContain('--pinned');
  });

  it('the store\'s resolved report is about another model: the actual device stays hidden for this slot', () => {
    mockAsrResolved = { model: 'other-model', device: 'vulkan' };
    const { container } = render(<SlotDeviceBadge stage="asr" modelId="m" id="b" />);
    expect(setting(container)).toHaveTextContent('Auto');
    expect(actual(container)).toBeNull();
  });

  it('a slot with no model picked shows the setting alone even when something resolved', () => {
    mockAsrResolved = { model: 'm', device: 'vulkan' };
    const { container } = render(<SlotDeviceBadge stage="asr" modelId={null} id="b" />);
    expect(actual(container)).toBeNull();
  });

  it('a resolved device that contradicts the setting is a leftover, not shown: cpu pin vs. vulkan report', () => {
    mockSettings = { ...mockSettings, asrDevice: 'cpu' };
    mockAsrResolved = { model: 'm', device: 'vulkan' };
    const { container } = render(<SlotDeviceBadge stage="asr" modelId="m" id="b" />);
    expect(setting(container)).toHaveTextContent('CPU');
    expect(actual(container)).toBeNull();
  });

  it('a resolved device that contradicts the setting is a leftover, not shown: gpu pin vs. cpu report', () => {
    mockSettings = { ...mockSettings, ttsDevice: 'gpu' };
    mockTtsResolved = { model: 'm', device: 'cpu' };
    const { container } = render(<SlotDeviceBadge stage="tts" modelId="m" id="b" />);
    expect(setting(container)).toHaveTextContent('GPU');
    expect(actual(container)).toBeNull();
  });

  it('maps resolved device kinds to their proper names, and unknown short tokens to acronyms', () => {
    mockTtsResolved = { model: 'm', device: 'metal' };
    const { container, unmount } = render(<SlotDeviceBadge stage="tts" modelId="m" id="b" />);
    expect(actual(container)).toHaveTextContent('Metal');
    unmount();
    mockTtsResolved = { model: 'm', device: 'cuda' };
    const second = render(<SlotDeviceBadge stage="tts" modelId="m" id="b" />);
    expect(actual(second.container)).toHaveTextContent('CUDA');
  });

  it('publishes its width to the host element as --slot-badge-w and clears it on unmount', () => {
    const { container, unmount } = render(<div><SlotDeviceBadge stage="asr" modelId="m" id="b" /></div>);
    const host = badge(container).parentElement!;
    expect(host.style.getPropertyValue('--slot-badge-w')).toMatch(/^\d+px$/);
    unmount();
    expect(host.style.getPropertyValue('--slot-badge-w')).toBe('');
  });
});
