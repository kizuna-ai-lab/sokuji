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
import { GEMINI_DEFAULTS, type GeminiSettings } from './settings';
import { GeminiSettingsView } from './GeminiSettings';

const DIALOGUE = 'gemini-2.5-flash-native-audio-preview-12-2025';
const TRANSLATE = 'gemini-3.5-live-translate-preview';

const props = (patch: Partial<SettingsProps<GeminiSettings>> = {}): SettingsProps<GeminiSettings> => ({
  settings: { ...GEMINI_DEFAULTS, model: DIALOGUE },
  update: vi.fn(),
  pair: { source: 'en-US', target: 'ja-JP' },
  models: [{ id: TRANSLATE }, { id: DIALOGUE }],
  ...patch,
});

describe('GeminiSettingsView', () => {
  it("draws the instructions over Gemini's own settings, previewing Quick's prompt for the pair (ruling 4)", () => {
    const update = vi.fn();
    const { container, rerender } = render(<GeminiSettingsView {...props({ update })} />);

    fireEvent.click(screen.getByRole('button', { name: 'settings.preview' }));
    expect(container.querySelector('.preview-content')?.textContent).toContain(
      'translate English (United States) → Japanese (Japan).'
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

    const voiceSelect = screen.getByLabelText('settings.voice') as HTMLSelectElement;
    expect(voiceSelect.options).toHaveLength(30);
    fireEvent.change(voiceSelect, { target: { value: 'Puck' } });
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
    expect(screen.queryByLabelText('settings.voice')).toBeNull();
  });

  it('Live Translate hides the voice and the model configuration, and keeps the model (choice 22)', () => {
    render(<GeminiSettingsView {...props({ settings: { ...GEMINI_DEFAULTS, model: TRANSLATE } })} />);
    expect(screen.queryByLabelText('settings.voice')).toBeNull();
    expect(screen.queryByLabelText('settings.temperature')).toBeNull();
    expect((screen.getByLabelText('settings.model') as HTMLSelectElement).value).toBe(TRANSLATE);
  });

  it('before a check has listed any model: the saved one alone, locked', () => {
    render(<GeminiSettingsView {...props({ models: [], settings: { ...GEMINI_DEFAULTS, model: 'gemini-3.1-flash-live-preview' } })} />);
    const select = screen.getByLabelText('settings.model') as HTMLSelectElement;
    expect(select).toBeDisabled();
    expect(select.options).toHaveLength(1);
    expect(select.options[0].value).toBe('gemini-3.1-flash-live-preview');
    expect(screen.getByLabelText('settings.voice')).toBeInTheDocument();
  });

  it('disabled locks every control', () => {
    render(<GeminiSettingsView {...props({ disabled: true })} />);
    expect(screen.getByRole('button', { name: 'settings.simple' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'settings.advanced' })).toBeDisabled();
    expect(screen.getByLabelText('settings.voice')).toBeDisabled();
    expect(screen.getByLabelText('settings.model')).toBeDisabled();
    expect(screen.getByLabelText('settings.temperature')).toBeDisabled();
    expect(screen.getByLabelText('Unlimited')).toBeDisabled();
  });
});
