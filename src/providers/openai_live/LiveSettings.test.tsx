import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useContext } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, values?: Record<string, unknown>) => {
      const options = typeof fallback === 'object' ? fallback : values;
      const text = typeof fallback === 'string' ? fallback : key;
      return options ? text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name])) : text;
    },
  }),
}));
vi.mock('../../components/Tooltip/Tooltip', () => ({ default: () => null }));
import type { VoiceLibrarySectionProps } from '../../components/Settings/sections/VoiceLibrarySection';
import { VoicePreviewContext } from '../../components/providers/VoicePreviewContext';
const { library, previewLiveVoice } = vi.hoisted(() => ({
  library: [] as Array<VoiceLibrarySectionProps & { port: unknown }>,
  previewLiveVoice: vi.fn(async () => null),
}));
vi.mock('../../components/Settings/sections/VoiceLibrarySection', () => ({
  default: function Library(props: VoiceLibrarySectionProps) {
    library.push({ ...props, port: useContext(VoicePreviewContext) });
    return null;
  },
}));
vi.mock('./preview', () => ({ previewLiveVoice }));
const libraryProps = () => library[library.length - 1];

import type { SettingsProps } from '../../lib/provider/types';
import { LiveSettingsView } from './LiveSettings';
import { LIVE_DEFAULTS, LIVE_VOICES, type LiveSettings } from './settings';

const props = (patch: Partial<SettingsProps<LiveSettings>> = {}): SettingsProps<LiveSettings> => ({
  settings: LIVE_DEFAULTS,
  update: vi.fn(),
  pair: { source: 'ja', target: 'en' },
  ...patch,
});
beforeEach(() => {
  library.length = 0;
  previewLiveVoice.mockClear();
});

const headings = (container: HTMLElement) => Array.from(container.querySelectorAll('.settings-section > h2')).map((h) => h.textContent);

describe('LiveSettingsView (choice 17)', () => {
  it('draws its instructions and its voice, and nothing else: no model, turn detection or noise reduction', () => {
    const { container } = render(<LiveSettingsView {...props()} />);
    expect(headings(container)).toEqual(['settings.systemInstructions', 'Voice Settings']);
    expect(screen.queryByLabelText('settings.model')).toBeNull();
    expect(screen.queryByLabelText('settings.noiseReduction')).toBeNull();
  });

  it("previews Quick's prompt for the pair — Auto-detect as the spoken language — and edits its own instructions", () => {
    const update = vi.fn();
    const { container } = render(<LiveSettingsView {...props({ update })} />);
    fireEvent.click(screen.getByRole('button', { name: 'settings.preview' }));
    expect(container.querySelector('.preview-content')?.textContent).toContain('translate Japanese → English.');
    fireEvent.click(screen.getByRole('button', { name: 'settings.advanced' }));
    expect(update).toHaveBeenCalledWith({ useTemplateMode: false });
    const { container: auto } = render(<LiveSettingsView {...props({ pair: { source: 'auto', target: 'zh-CN' } })} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'settings.preview' })[1]);
    expect(auto.querySelector('.preview-content')?.textContent).toContain('translate the spoken language → Chinese (China).');
  });

  it('offers the 22 voices in the voice library and writes the one chosen; locked while a run is not idle', () => {
    const update = vi.fn();
    render(<LiveSettingsView {...props({ update })} />);
    const library = libraryProps();
    expect(library.voices.map((v) => v.id)).toEqual(LIVE_VOICES.map((v) => v.value));
    expect(library.selectedId).toBe('marin');
    library.onSelect('cinder');
    expect(update).toHaveBeenCalledWith({ voice: 'cinder' });
    expect(library.isSessionActive).toBe(false);
    render(<LiveSettingsView {...props({ disabled: true })} />);
    expect(libraryProps().isSessionActive).toBe(true);
  });

  it("shows a Realtime voice by its name alone, and a voice Live added with its documented presentation and accent (decision 2026-10-03)", () => {
    render(<LiveSettingsView {...props()} />);
    const byId = (id: string) => libraryProps().voices.find((v) => v.id === id);
    expect(byId('marin')).toEqual({ id: 'marin', label: 'Marin', group: 'builtin', removable: false, previewable: true, section: 'Same as Realtime' });
    expect(byId('quartz')).toMatchObject({ label: 'Quartz', previewable: true, meta: { gender: 'F', facets: { gender: 'female', description: 'Australian English' } } });
  });

  it('lists the ten Realtime voices and the twelve Live added under headings of their own: why only the twelve carry labels (decision 2026-10-03)', () => {
    render(<LiveSettingsView {...props()} />);
    const sections = libraryProps().voices.map((v) => v.section);
    expect(sections).toEqual([...Array(10).fill('Same as Realtime'), ...Array(12).fill('Added in GPT-Live')]);
  });

  it("auditions a voice with its published sample, through the host's preview route; free, so no note and no key", async () => {
    const port = { play: vi.fn(async () => {}), stop: vi.fn() };
    render(<LiveSettingsView {...props({ preview: port })} />);
    const library = libraryProps();
    expect(library.port).toBe(port);
    expect(library.manageNote).toBeUndefined();
    expect(library.previewUnavailableReason).toBeUndefined();
    const signal = new AbortController().signal;
    await library.onPreview!('cinder', signal);
    expect(previewLiveVoice).toHaveBeenCalledWith('cinder', signal);
  });
});
