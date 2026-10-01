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
vi.mock('../../components/Tooltip/Tooltip', () => ({ default: () => null }));

import type { SettingsProps } from '../../lib/provider/types';
import { LiveSettingsView } from './LiveSettings';
import { LIVE_DEFAULTS, type LiveSettings } from './settings';

const props = (patch: Partial<SettingsProps<LiveSettings>> = {}): SettingsProps<LiveSettings> => ({
  settings: LIVE_DEFAULTS,
  update: vi.fn(),
  pair: { source: 'ja', target: 'en' },
  ...patch,
});
const headings = (container: HTMLElement) => Array.from(container.querySelectorAll('.settings-section > h2')).map((h) => h.textContent);

describe('LiveSettingsView (choice 17)', () => {
  it('draws its instructions and its voice, and nothing else: no model, turn detection or noise reduction', () => {
    const { container } = render(<LiveSettingsView {...props()} />);
    expect(headings(container)).toEqual(['settings.systemInstructions', 'settings.voice']);
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
    const { container: auto } = render(<LiveSettingsView {...props({ pair: { source: 'auto', target: 'zh_CN' } })} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'settings.preview' })[1]);
    expect(auto.querySelector('.preview-content')?.textContent).toContain('translate the spoken language → Chinese (China).');
  });

  it('offers the 22 voices and writes the one chosen; locked while a run is not idle', () => {
    const update = vi.fn();
    render(<LiveSettingsView {...props({ update })} />);
    const voice = screen.getByLabelText('settings.voice') as HTMLSelectElement;
    expect(voice.options).toHaveLength(22);
    expect(voice.value).toBe('marin');
    fireEvent.change(voice, { target: { value: 'cinder' } });
    expect(update).toHaveBeenCalledWith({ voice: 'cinder' });
    const { container } = render(<LiveSettingsView {...props({ disabled: true })} />);
    expect((container.querySelector('select[aria-label="settings.voice"]') as HTMLSelectElement).disabled).toBe(true);
  });
});
