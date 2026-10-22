import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, values?: Record<string, unknown>) => {
      const options = typeof fallback === 'object' ? fallback : values;
      const text = typeof fallback === 'string' ? fallback : key;
      return options ? text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name])) : text;
    },
  }),
}));
// A tooltip draws nothing, but its words stay reachable for a test that reads what a row says: the `data-tooltip` attribute.
vi.mock('../../components/Tooltip/Tooltip', () => ({ default: ({ content }: { content?: unknown }) => (typeof content === 'string' ? <i data-tooltip={content} /> : null) }));
import type { VoiceLibrarySectionProps } from '../../components/Settings/sections/VoiceLibrarySection';
const { library } = vi.hoisted(() => ({ library: [] as VoiceLibrarySectionProps[] }));
vi.mock('../../components/Settings/sections/VoiceLibrarySection', () => ({
  default: function Library(props: VoiceLibrarySectionProps) {
    library.push(props);
    return null;
  },
}));

import type { SettingsProps } from '../../lib/provider/types';
import { KizunaQwenSettingsView, QwenSettingsView, QwenVoiceSummary } from './QwenSettings';
import { QWEN_DEFAULTS, QWEN_VOICES, SPEAKER_CLONE, SPEAKER_CLONE_ONCE, type QwenSettings } from './settings';

const props = (patch: Partial<SettingsProps<QwenSettings>> = {}): SettingsProps<QwenSettings> => ({ settings: QWEN_DEFAULTS, update: vi.fn(), ...patch });
beforeEach(() => {
  library.length = 0;
});

describe('QwenSettingsView (spec §4, §7)', () => {
  it("lists the two clones first under their own heading — every turn, then the first speaker once — then the 47 presets under Presets, with no preview", () => {
    render(<QwenSettingsView {...props()} />);
    expect(library).toHaveLength(1);
    const [mine] = library;
    expect(mine.voices.slice(0, 2)).toEqual([
      { id: SPEAKER_CLONE, label: "Clone the speaker's voice", group: 'builtin', removable: false, section: 'Voice cloning' },
      { id: SPEAKER_CLONE_ONCE, label: "Clone the first speaker's voice", group: 'builtin', removable: false, section: 'Voice cloning' },
    ]);
    expect(mine.voices.slice(2).map((v) => v.id)).toEqual(QWEN_VOICES.map((v) => v.value));
    expect(mine.voices.slice(2).every((v) => v.section === undefined)).toBe(true);
    expect(mine.onPreview).toBeUndefined();
    expect(mine.selectedId).toBe('Tina');
  });

  it('edits the preferred translations, one source=target per line, under Custom Vocabulary', () => {
    const update = vi.fn();
    const { container } = render(<QwenSettingsView {...props({ update, settings: { ...QWEN_DEFAULTS, hotwords: '实时翻译=LiveTranslate' } })} />);
    expect(Array.from(container.querySelectorAll('.settings-section > h2')).map((h) => h.textContent)).toContain('Custom Vocabulary');
    const field = screen.getByLabelText('Preferred Translations') as HTMLTextAreaElement;
    expect(field.value).toBe('实时翻译=LiveTranslate');
    expect(field.placeholder).toBe('One source=target per line');
    fireEvent.change(field, { target: { value: '实时翻译=LiveTranslate\n交流=chat' } });
    expect(update).toHaveBeenCalledWith({ hotwords: '实时翻译=LiveTranslate\n交流=chat' });
  });

  it('locks the vocabulary while a run is not idle', () => {
    render(<QwenSettingsView {...props({ disabled: true })} />);
    expect((screen.getByLabelText('Preferred Translations') as HTMLTextAreaElement).disabled).toBe(true);
  });

  it('writes my choice, the clone included', () => {
    const update = vi.fn();
    render(<QwenSettingsView {...props({ update })} />);
    library[0].onSelect(SPEAKER_CLONE);
    expect(update).toHaveBeenCalledWith({ voice: SPEAKER_CLONE });
  });

  it("adds the other party's row only while the participant speaks, writing its own field", () => {
    const update = vi.fn();
    render(<QwenSettingsView {...props({ update, participantSpeaks: true })} />);
    expect(library).toHaveLength(2);
    expect(library[1].selectedId).toBe('Ethan');
    library[1].onSelect('Serena');
    expect(update).toHaveBeenCalledWith({ participantVoice: 'Serena' });
  });

  it('offers Screen context as a switch under the voice, off by default, writing only that field', () => {
    const update = vi.fn();
    render(<QwenSettingsView settings={QWEN_DEFAULTS} update={update} />);
    const sw = screen.getByRole('switch', { name: 'Screen context' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(update).toHaveBeenCalledWith({ screenContext: true });
  });
  it('marks the switch Beta, as a badge right after its label (owner, 2026-10-22)', () => {
    render(<QwenSettingsView settings={QWEN_DEFAULTS} update={() => {}} />);
    const row = screen.getByTestId('qwen-screen-context');
    const badge = row.querySelector('.setting-row__badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe('Beta');
    expect(badge!.previousElementSibling!.textContent).toBe('Screen context');
  });
  it('locks the switch while a run is not idle, and says in words only where frames go and how they are billed', () => {
    const update = vi.fn();
    render(<QwenSettingsView settings={QWEN_DEFAULTS} update={update} disabled />);
    const sw = screen.getByRole('switch', { name: 'Screen context' });
    // The switch is a div with role="switch", so it is locked by aria-disabled, not by a disabled attribute.
    expect(sw).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(sw);
    expect(update).not.toHaveBeenCalled();
    const row = screen.getByTestId('qwen-screen-context');
    const tooltips = Array.from(row.querySelectorAll('[data-tooltip]'), (el) => el.getAttribute('data-tooltip')).join(' ');
    const words = `${row.textContent} ${tooltips}`;
    expect(words).toMatch(/Alibaba Cloud/);
    expect(words).toMatch(/Kizuna AI never receives them/);
    expect(words).not.toMatch(/[$¥%\d]/);
    // Where the pictures go is on the line always shown, not only in the tooltip.
    expect(row.textContent).toMatch(/Alibaba Cloud's Qwen service/);
    expect(row.textContent).toMatch(/Kizuna AI never receives them/);
    // The charge is per second of speech, whichever account pays it.
    expect(tooltips).toMatch(/for every second of speech/);
    expect(tooltips).toMatch(/Alibaba Cloud bill with your own key/);
  });

  it('names the storefront the check found under the key, and nothing before a check', () => {
    const { rerender } = render(<QwenSettingsView {...props({ models: [{ id: 'cn' }] })} />);
    expect(screen.getByText('Key from 千问云 (mainland China)')).toBeTruthy();
    rerender(<QwenSettingsView {...props({ models: [{ id: 'intl' }] })} />);
    expect(screen.getByText('Key from QwenCloud (international)')).toBeTruthy();
    rerender(<QwenSettingsView {...props({ models: [] })} />);
    expect(screen.queryByText(/^Key from/)).toBeNull();
  });
});

describe('KizunaQwenSettingsView (the managed view, Beijing region spec §8)', () => {
  it('renders a Region select with Singapore and 北京 (Beijing), selected from the settings, above the shared view', () => {
    const { container } = render(<KizunaQwenSettingsView {...props({ settings: { ...QWEN_DEFAULTS, region: 'cn' } })} />);
    const select = container.querySelector('#qwen-region-select') as HTMLSelectElement;
    expect(select.value).toBe('cn');
    expect(Array.from(select.options).map((o) => [o.value, o.textContent])).toEqual([['sg', 'Singapore'], ['cn', '北京 (Beijing)']]);
    expect(select.closest('.settings-section')?.querySelector('h2')?.textContent).toContain('Region');
    expect(library).toHaveLength(1);
  });

  it('picking Beijing writes the region and nothing else', () => {
    const update = vi.fn();
    const { container } = render(<KizunaQwenSettingsView {...props({ update })} />);
    fireEvent.change(container.querySelector('#qwen-region-select') as HTMLSelectElement, { target: { value: 'cn' } });
    expect(update).toHaveBeenCalledWith({ region: 'cn' });
  });

  it('locks the select while a run is not idle', () => {
    const { container } = render(<KizunaQwenSettingsView {...props({ disabled: true })} />);
    expect((container.querySelector('#qwen-region-select') as HTMLSelectElement).disabled).toBe(true);
  });

  // Beijing answers slowly from networks outside mainland China (2026-10-21: 9–15 s to the first
  // word from Japan over IPv6, against 0.7 s to Singapore). The note under the select is what a
  // visitor who picked it sees without hovering the tooltip; Singapore shows nothing.
  it('shows the latency note under the select only while Beijing is picked', () => {
    const beijing = render(<KizunaQwenSettingsView {...props({ settings: { ...QWEN_DEFAULTS, region: 'cn' } })} />);
    const note = beijing.container.querySelector('#qwen-region-note');
    expect(note?.textContent).toContain('try Singapore');
    expect(note?.closest('#qwen-region-section')).not.toBeNull();
    beijing.unmount();
    const singapore = render(<KizunaQwenSettingsView {...props({ settings: { ...QWEN_DEFAULTS, region: 'sg' } })} />);
    expect(singapore.container.querySelector('#qwen-region-note')).toBeNull();
  });

  it('the managed view shows the same switch', () => {
    render(<KizunaQwenSettingsView settings={QWEN_DEFAULTS} update={() => {}} />);
    expect(screen.getByRole('switch', { name: 'Screen context' })).toBeInTheDocument();
  });

  it('the own-key view shows no region', () => {
    const { container } = render(<QwenSettingsView {...props()} />);
    expect(container.querySelector('#qwen-region-select')).toBeNull();
  });
});

describe('QwenVoiceSummary', () => {
  it("names each leg's voice as its run speaks it, and the clone by whose voice it is", () => {
    const summary = (settings: QwenSettings, leg: 'speaker' | 'participant') => render(<QwenVoiceSummary {...props({ settings })} leg={leg} />).container.textContent;
    expect(summary({ ...QWEN_DEFAULTS, voice: SPEAKER_CLONE, participantVoice: 'Liora Mira' }, 'speaker')).toBe('Your own voice (cloned)');
    expect(summary({ ...QWEN_DEFAULTS, voice: SPEAKER_CLONE_ONCE, participantVoice: 'Liora Mira' }, 'speaker')).toBe('Your own voice (cloned)');
    expect(summary({ ...QWEN_DEFAULTS, voice: SPEAKER_CLONE, participantVoice: SPEAKER_CLONE }, 'participant')).toBe('Their own voice (cloned)');
    expect(summary({ ...QWEN_DEFAULTS, voice: 'Tina', participantVoice: SPEAKER_CLONE_ONCE }, 'participant')).toBe('Their own voice (cloned)');
    expect(summary({ ...QWEN_DEFAULTS, voice: SPEAKER_CLONE, participantVoice: 'Liora Mira' }, 'participant')).toBe('Liora Mira');
    expect(summary({ ...QWEN_DEFAULTS, voice: 'Ethan', participantVoice: 'Ethan' }, 'participant')).toBe('Tina');
  });
});
