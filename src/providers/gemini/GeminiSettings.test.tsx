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
const tooltips: unknown[] = [];
vi.mock('../../components/Tooltip/Tooltip', () => ({ default: ({ content }: { content: unknown }) => { tooltips.push(content); return null; } }));
import type { VoiceLibrarySectionProps } from '../../components/Settings/sections/VoiceLibrarySection';
import { VoicePreviewContext } from '../../components/providers/VoicePreviewContext';
const { library, previewGeminiVoice } = vi.hoisted(() => ({
  library: [] as Array<VoiceLibrarySectionProps & { port: unknown }>,
  previewGeminiVoice: vi.fn(async () => null),
}));
vi.mock('../../components/Settings/sections/VoiceLibrarySection', () => ({
  default: function Library(props: VoiceLibrarySectionProps) {
    library.push({ ...props, port: useContext(VoicePreviewContext) });
    return null;
  },
}));
vi.mock('./preview', () => ({ previewGeminiVoice }));
const libraryProps = () => library[library.length - 1];

import type { SettingsProps } from '../../lib/provider/types';
import { GEMINI_DEFAULTS, GEMINI_VOICES, type GeminiSettings } from './settings';
import { GeminiSettingsView } from './GeminiSettings';

const DIALOGUE = 'gemini-2.5-flash-native-audio-preview-12-2025';
const TRANSLATE = 'gemini-3.5-live-translate-preview';

const props = (patch: Partial<SettingsProps<GeminiSettings>> = {}): SettingsProps<GeminiSettings> => ({
  settings: { ...GEMINI_DEFAULTS, model: DIALOGUE },
  update: vi.fn(),
  pair: { source: 'en', target: 'ja' },
  models: [{ id: TRANSLATE }, { id: DIALOGUE }],
  ...patch,
});

const signedOut = { signedIn: false, getToken: async () => null };

beforeEach(() => {
  library.length = 0;
  previewGeminiVoice.mockClear();
});

describe('GeminiSettingsView', () => {
  it("draws the instructions over Gemini's own settings, previewing Quick's prompt for the pair (ruling 4)", () => {
    const update = vi.fn();
    const { container, rerender } = render(<GeminiSettingsView {...props({ update })} />);

    fireEvent.click(screen.getByRole('button', { name: 'settings.preview' }));
    expect(container.querySelector('.preview-content')?.textContent).toContain(
      'translate English → Japanese.'
    );

    fireEvent.click(screen.getByRole('button', { name: 'settings.advanced' }));
    expect(update).toHaveBeenCalledWith({ useTemplateMode: false });

    rerender(<GeminiSettingsView {...props({ update, settings: { ...GEMINI_DEFAULTS, useTemplateMode: false, systemInstructions: 'mine' } })} />);
    const textarea = screen.getByLabelText('settings.systemInstructions') as HTMLTextAreaElement;
    expect(textarea.value).toBe('mine');
    fireEvent.change(textarea, { target: { value: 'new text' } });
    expect(update).toHaveBeenCalledWith({ systemInstructions: 'new text' });
  });

  it('a dialogue model: the voice, the model with its effective choice, and the model configuration, each writing Gemini\'s settings', () => {
    const update = vi.fn();
    render(<GeminiSettingsView {...props({ update })} />);

    const voices = libraryProps();
    expect(voices.voices.map((v) => v.id)).toEqual(GEMINI_VOICES.map((v) => v.value));
    expect(voices.selectedId).toBe('Aoede');
    voices.onSelect('Puck');
    expect(update).toHaveBeenCalledWith({ voice: 'Puck' });

    const modelSelect = screen.getByLabelText('settings.model') as HTMLSelectElement;
    expect(modelSelect.value).toBe(DIALOGUE);
    expect(Array.from(modelSelect.options).map((o) => o.value)).toEqual([TRANSLATE, DIALOGUE]);
    fireEvent.change(modelSelect, { target: { value: TRANSLATE } });
    expect(update).toHaveBeenCalledWith({ model: TRANSLATE });

    const temperature = screen.getByLabelText('settings.temperature') as HTMLInputElement;
    expect(temperature.max).toBe('2');
    fireEvent.change(temperature, { target: { value: '1.1' } });
    expect(update).toHaveBeenCalledWith({ temperature: 1.1 });

    fireEvent.click(screen.getByLabelText('Unlimited'));
    expect(update).toHaveBeenCalledWith({ maxTokens: 8192 });
  });

  it('a fresh profile, no model saved, shows Live Translate as its model: the default when listed (Gemini/AST2 follow-up, ruling 3)', () => {
    render(<GeminiSettingsView {...props({ settings: GEMINI_DEFAULTS })} />);
    expect((screen.getByLabelText('settings.model') as HTMLSelectElement).value).toBe(TRANSLATE);
    expect(library).toHaveLength(0);
  });

  it('Live Translate hides the voice and the model configuration, and keeps the model (choice 22)', () => {
    render(<GeminiSettingsView {...props({ settings: { ...GEMINI_DEFAULTS, model: TRANSLATE } })} />);
    expect(library).toHaveLength(0);
    expect(screen.queryByLabelText('settings.temperature')).toBeNull();
    expect((screen.getByLabelText('settings.model') as HTMLSelectElement).value).toBe(TRANSLATE);
  });

  it('before a check has listed any model: the saved one alone, locked', () => {
    render(<GeminiSettingsView {...props({ models: [], settings: { ...GEMINI_DEFAULTS, model: 'gemini-3.1-flash-live-preview' } })} />);
    const select = screen.getByLabelText('settings.model') as HTMLSelectElement;
    expect(select).toBeDisabled();
    expect(select.options).toHaveLength(1);
    expect(select.options[0].value).toBe('gemini-3.1-flash-live-preview');
    expect(library.length).toBeGreaterThan(0);
  });

  it("shows each voice's documented gender and style (decision 2026-10-03)", () => {
    render(<GeminiSettingsView {...props()} />);
    expect(libraryProps().voices.find((v) => v.id === 'Kore')).toEqual({
      id: 'Kore', label: 'Kore', group: 'builtin', removable: false, previewable: true,
      meta: { gender: 'F', facets: { gender: 'female', style: ['firm'] } },
    });
  });

  it("auditions a voice by synthesizing the target's sentence on the saved key, through the host's preview route, and says it may be billed", async () => {
    const port = { play: vi.fn(async () => {}), stop: vi.fn() };
    render(<GeminiSettingsView {...props({ preview: port, account: { credentials: { apiKey: 'k-1' }, auth: signedOut } })} />);
    const voices = libraryProps();
    expect(voices.port).toBe(port);
    expect(voices.previewUnavailableReason).toBeUndefined();
    expect(voices.manageNote).toBe('Previewing a voice synthesizes one short sentence with your Gemini API key, which Google may bill.');
    const signal = new AbortController().signal;
    await voices.onPreview!('Kore', signal);
    expect(previewGeminiVoice).toHaveBeenCalledWith({ voice: 'Kore', target: 'ja', apiKey: 'k-1' }, signal);
  });

  it('greys the audition out, saying why, until a key is saved', () => {
    render(<GeminiSettingsView {...props({ account: { credentials: {}, auth: signedOut } })} />);
    expect(libraryProps().onPreview).toBeDefined();
    expect(libraryProps().previewUnavailableReason).toBe('Save your API key to preview voices.');
  });

  it('disabled locks every control', () => {
    render(<GeminiSettingsView {...props({ disabled: true })} />);
    expect(screen.getByRole('button', { name: 'settings.simple' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'settings.advanced' })).toBeDisabled();
    expect(libraryProps().isSessionActive).toBe(true);
    expect(screen.getByLabelText('settings.model')).toBeDisabled();
    expect(screen.getByLabelText('settings.temperature')).toBeDisabled();
    expect(screen.getByLabelText('Unlimited')).toBeDisabled();
  });
});
