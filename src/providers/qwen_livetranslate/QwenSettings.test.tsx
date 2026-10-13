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
vi.mock('../../components/Tooltip/Tooltip', () => ({ default: () => null }));
import type { VoiceLibrarySectionProps } from '../../components/Settings/sections/VoiceLibrarySection';
const { library } = vi.hoisted(() => ({ library: [] as VoiceLibrarySectionProps[] }));
vi.mock('../../components/Settings/sections/VoiceLibrarySection', () => ({
  default: function Library(props: VoiceLibrarySectionProps) {
    library.push(props);
    return null;
  },
}));

import type { SettingsProps } from '../../lib/provider/types';
import { QwenSettingsView, QwenVoiceSummary } from './QwenSettings';
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

  it('names the storefront the check found under the key, and nothing before a check', () => {
    const { rerender } = render(<QwenSettingsView {...props({ models: [{ id: 'cn' }] })} />);
    expect(screen.getByText('Key from 千问云 (mainland China)')).toBeTruthy();
    rerender(<QwenSettingsView {...props({ models: [{ id: 'intl' }] })} />);
    expect(screen.getByText('Key from QwenCloud (international)')).toBeTruthy();
    rerender(<QwenSettingsView {...props({ models: [] })} />);
    expect(screen.queryByText(/^Key from/)).toBeNull();
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
