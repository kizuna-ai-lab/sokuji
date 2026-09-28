import { describe, it, expect, vi } from 'vitest';
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

import type { SettingsProps } from '../../lib/provider/types';
import { RealtimeSettingsView } from './RealtimeSettings';
import { REALTIME_DEFAULTS, type RealtimeSettings } from './settings';

const props = (patch: Partial<SettingsProps<RealtimeSettings>> = {}): SettingsProps<RealtimeSettings> => ({
  settings: REALTIME_DEFAULTS,
  update: vi.fn(),
  pair: { source: 'ja', target: 'en' },
  models: [{ id: 'gpt-realtime-2.1' }, { id: 'gpt-realtime-2.1-mini' }, { id: 'gpt-realtime-mini' }],
  ...patch,
});
const headings = (container: HTMLElement) => Array.from(container.querySelectorAll('.settings-section > h2')).map((h) => h.textContent);

describe('RealtimeSettingsView (choice 17)', () => {
  it('draws the old sections in the old order: instructions, voice, model, transcript, noise, model configuration, reasoning — and no transport, temperature or push mode', () => {
    const { container } = render(<RealtimeSettingsView {...props()} />);
    expect(headings(container)).toEqual([
      'settings.systemInstructions', 'settings.voice', 'settings.model', 'settings.userTranscriptModel', 'settings.noiseReduction',
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
    const voice = screen.getByLabelText('settings.voice') as HTMLSelectElement;
    expect(voice.options).toHaveLength(10);
    fireEvent.change(voice, { target: { value: 'marin' } });
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

  it('disabled locks every control', () => {
    render(<RealtimeSettingsView {...props({ disabled: true, settings: { ...REALTIME_DEFAULTS, transcriptModel: 'gpt-transcribe' } })} />);
    for (const label of ['settings.voice', 'settings.model', 'settings.userTranscriptModel', 'Transcription keywords', 'settings.noiseReduction', 'Unlimited', 'settings.reasoningEffort']) {
      expect(screen.getByLabelText(label), label).toBeDisabled();
    }
    expect(screen.getByRole('button', { name: 'settings.advanced' })).toBeDisabled();
  });
});
