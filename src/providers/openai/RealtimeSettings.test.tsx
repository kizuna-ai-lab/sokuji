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
const { library, previewRealtimeVoice } = vi.hoisted(() => ({
  library: [] as Array<VoiceLibrarySectionProps & { port: unknown }>,
  previewRealtimeVoice: vi.fn(async () => null),
}));
vi.mock('../../components/Settings/sections/VoiceLibrarySection', () => ({
  default: function Library(props: VoiceLibrarySectionProps) {
    library.push({ ...props, port: useContext(VoicePreviewContext) });
    return null;
  },
}));
vi.mock('./preview', () => ({ previewRealtimeVoice }));
const libraryProps = () => library[library.length - 1];

import type { SettingsProps } from '../../lib/provider/types';
import { RealtimeSettingsView } from './RealtimeSettings';
import { REALTIME_DEFAULTS, REALTIME_VOICES, type RealtimeSettings } from './settings';

const props = (patch: Partial<SettingsProps<RealtimeSettings>> = {}): SettingsProps<RealtimeSettings> => ({
  settings: REALTIME_DEFAULTS,
  update: vi.fn(),
  pair: { source: 'ja', target: 'en' },
  models: [{ id: 'gpt-realtime-2.1' }, { id: 'gpt-realtime-2.1-mini' }, { id: 'gpt-realtime-mini' }],
  ...patch,
});
beforeEach(() => {
  library.length = 0;
  previewRealtimeVoice.mockClear();
});

const headings = (container: HTMLElement) => Array.from(container.querySelectorAll('.settings-section > h2')).map((h) => h.textContent);

describe('RealtimeSettingsView (choice 17)', () => {
  it('draws the old sections in the old order: instructions, voice, model, transcript, noise, model configuration, reasoning — and no transport, temperature or push mode', () => {
    const { container } = render(<RealtimeSettingsView {...props()} />);
    expect(headings(container)).toEqual([
      'settings.systemInstructions', 'Voice Settings', 'settings.model', 'settings.userTranscriptModel', 'settings.noiseReduction',
      'settings.modelConfiguration', 'settings.reasoningEffort',
    ]);
    expect(screen.queryByLabelText('settings.temperature')).toBeNull();
    expect(container.textContent).not.toMatch(/WebRTC|settings\.pushToTalk|settings\.pushToTranslate/);
  });

  it("previews Quick's prompt for the pair, and edits its own instructions", () => {
    const update = vi.fn();
    const { container } = render(<RealtimeSettingsView {...props({ update })} />);
    fireEvent.click(screen.getByRole('button', { name: 'settings.preview' }));
    expect(container.querySelector('.preview-content')?.textContent).toContain('translate Japanese → English.');
    fireEvent.click(screen.getByRole('button', { name: 'settings.advanced' }));
    expect(update).toHaveBeenCalledWith({ useTemplateMode: false });
  });

  it('writes the voice, the model — shown as the effective one — the noise reduction and the max tokens', () => {
    const update = vi.fn();
    render(<RealtimeSettingsView {...props({ update, settings: { ...REALTIME_DEFAULTS, model: 'gpt-realtime-9' } })} />);
    const library = libraryProps();
    expect(library.voices.map((v) => v.id)).toEqual(REALTIME_VOICES.map((v) => v.value));
    library.onSelect('marin');
    expect(update).toHaveBeenCalledWith({ voice: 'marin' });
    const model = screen.getByLabelText('settings.model') as HTMLSelectElement;
    expect(model.value).toBe('gpt-realtime-2.1-mini');
    fireEvent.change(model, { target: { value: 'gpt-realtime-mini' } });
    expect(update).toHaveBeenCalledWith({ model: 'gpt-realtime-mini' });
    fireEvent.change(screen.getByLabelText('settings.noiseReduction'), { target: { value: 'Near field' } });
    expect(update).toHaveBeenCalledWith({ noiseReduction: 'Near field' });
    fireEvent.click(screen.getByLabelText('Unlimited'));
    expect(update).toHaveBeenCalledWith({ maxTokens: 4096 });
  });

  it('shows the transcription keywords only for a model that takes them, and writes both', () => {
    const update = vi.fn();
    const { rerender } = render(<RealtimeSettingsView {...props({ update })} />);
    expect(screen.queryByLabelText('Transcription keywords')).toBeNull();
    const transcript = screen.getByLabelText('settings.userTranscriptModel') as HTMLSelectElement;
    expect(Array.from(transcript.options).map((o) => o.value)).toEqual(['gpt-live-transcribe', 'gpt-transcribe', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1']);
    fireEvent.change(transcript, { target: { value: 'gpt-live-transcribe' } });
    expect(update).toHaveBeenCalledWith({ transcriptModel: 'gpt-live-transcribe' });
    rerender(<RealtimeSettingsView {...props({ update, settings: { ...REALTIME_DEFAULTS, transcriptModel: 'gpt-live-transcribe', transcriptKeywords: 'Sokuji' } })} />);
    const keywords = screen.getByLabelText('Transcription keywords') as HTMLInputElement;
    expect(keywords.value).toBe('Sokuji');
    fireEvent.change(keywords, { target: { value: 'Sokuji, Kizuna AI' } });
    expect(update).toHaveBeenCalledWith({ transcriptKeywords: 'Sokuji, Kizuna AI' });
  });

  it('draws the reasoning effort for a gpt-realtime-2* model alone, with its option words', () => {
    const update = vi.fn();
    const { rerender } = render(<RealtimeSettingsView {...props({ update })} />);
    const effort = screen.getByLabelText('settings.reasoningEffort') as HTMLSelectElement;
    expect(Array.from(effort.options).map((o) => [o.value, o.textContent])).toEqual([
      ['minimal', 'minimal'], ['low', 'low'], ['medium', 'medium'], ['high', 'high'], ['xhigh', 'xhigh'],
    ]);
    fireEvent.change(effort, { target: { value: 'medium' } });
    expect(update).toHaveBeenCalledWith({ reasoningEffort: 'medium' });
    rerender(<RealtimeSettingsView {...props({ update, settings: { ...REALTIME_DEFAULTS, model: 'gpt-realtime-mini' } })} />);
    expect(screen.queryByLabelText('settings.reasoningEffort')).toBeNull();
  });

  it("lists each voice by its name alone and auditions it with its published sample, through the host's preview route (preset voice preview)", async () => {
    const port = { play: vi.fn(async () => {}), stop: vi.fn() };
    render(<RealtimeSettingsView {...props({ preview: port })} />);
    const library = libraryProps();
    expect(library.voices.find((v) => v.id === 'cedar')).toEqual({ id: 'cedar', label: 'Cedar', group: 'builtin', removable: false, previewable: true });
    expect(library.selectedId).toBe(REALTIME_DEFAULTS.voice);
    expect(library.port).toBe(port);
    expect(library.manageNote).toBeUndefined();
    const signal = new AbortController().signal;
    await library.onPreview!('cedar', signal);
    expect(previewRealtimeVoice).toHaveBeenCalledWith('cedar', signal);
  });

  it('disabled locks every control', () => {
    render(<RealtimeSettingsView {...props({ disabled: true, settings: { ...REALTIME_DEFAULTS, transcriptModel: 'gpt-transcribe' } })} />);
    expect(libraryProps().isSessionActive).toBe(true);
    for (const label of ['settings.model', 'settings.userTranscriptModel', 'Transcription keywords', 'settings.noiseReduction', 'Unlimited', 'settings.reasoningEffort']) {
      expect(screen.getByLabelText(label), label).toBeDisabled();
    }
    expect(screen.getByRole('button', { name: 'settings.advanced' })).toBeDisabled();
  });
});
