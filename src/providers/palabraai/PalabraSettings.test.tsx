import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { PalabraSettingsView } from './PalabraSettings';
import { PALABRA_DEFAULTS } from './settings';

const slider = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const buttons = (label: string) => within(screen.getByRole('group', { name: label })).getAllByRole('button');

describe("Palabra AI's settings view (D18)", () => {
  it('draws, in the old order, the voice, speech processing and the audio buffer, and nothing in English of its own (ruling 10)', () => {
    const { container } = render(<PalabraSettingsView settings={PALABRA_DEFAULTS} update={vi.fn()} />);
    expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual(['settings.voice', 'settings.speechProcessing', 'settings.queueConfiguration']);
    expect((screen.getByLabelText('settings.voice') as HTMLSelectElement).value).toBe('default_low');
    expect(Array.from((screen.getByLabelText('settings.voice') as HTMLSelectElement).options).map((o) => [o.value, o.textContent])).toEqual([
      ['default_low', 'Default Low'], ['default_high', 'Default High'],
    ]);
    // The old three `title` tooltips, English-only, are gone.
    expect(container.querySelectorAll('[title]')).toHaveLength(0);
  });

  it('writes the voice and each switch to its own field', () => {
    const update = vi.fn();
    render(<PalabraSettingsView settings={PALABRA_DEFAULTS} update={update} />);
    fireEvent.change(screen.getByLabelText('settings.voice'), { target: { value: 'default_high' } });
    fireEvent.click(buttons('settings.sentenceSplitter')[1]);
    fireEvent.click(buttons('settings.translatePartialTranscriptions')[0]);
    fireEvent.click(buttons('settings.autoTempo')[0]);
    expect(update.mock.calls).toEqual([
      [{ voiceId: 'default_high' }], [{ sentenceSplitterEnabled: false }], [{ translatePartialTranscriptions: true }], [{ autoTempo: true }],
    ]);
    expect(buttons('settings.sentenceSplitter').map((b) => [b.textContent, b.className])).toEqual([
      ['settings.enabled', 'option-button active'], ['settings.disabled', 'option-button '],
    ]);
  });

  it('draws the buffer on the old sliders, the max slider\'s floor following the target (ruling 10)', () => {
    const update = vi.fn();
    render(<PalabraSettingsView settings={PALABRA_DEFAULTS} update={update} />);
    const desired = slider('settings.desiredQueueLevel');
    expect([desired.min, desired.max, desired.step, desired.value]).toEqual(['3000', '15000', '1000', '8000']);
    const max = slider('settings.maxQueueLevel');
    expect([max.min, max.max, max.step, max.value]).toEqual(['12000', '60000', '3000', '24000']);
    expect(screen.getByText('8.0s')).toBeInTheDocument();
    expect(screen.getByText('24.0s')).toBeInTheDocument();
    fireEvent.change(desired, { target: { value: '9000' } });
    fireEvent.change(max, { target: { value: '30000' } });
    expect(update.mock.calls).toEqual([[{ desiredQueueLevelMs: 9_000 }], [{ maxQueueLevelMs: 30_000 }]]);
  });

  it('shows a stored max that is not above the target raised to its floor, as a session sends it', () => {
    render(<PalabraSettingsView settings={{ ...PALABRA_DEFAULTS, desiredQueueLevelMs: 15_000, maxQueueLevelMs: 12_000 }} update={vi.fn()} />);
    const max = slider('settings.maxQueueLevel');
    expect([max.min, max.value]).toEqual(['18000', '18000']);
    expect(screen.getByText('18.0s')).toBeInTheDocument();
  });

  it('locks every control while disabled', () => {
    render(<PalabraSettingsView settings={PALABRA_DEFAULTS} update={vi.fn()} disabled />);
    expect(screen.getByLabelText('settings.voice')).toBeDisabled();
    expect(slider('settings.desiredQueueLevel')).toBeDisabled();
    expect(slider('settings.maxQueueLevel')).toBeDisabled();
    for (const label of ['settings.sentenceSplitter', 'settings.translatePartialTranscriptions', 'settings.autoTempo']) {
      for (const b of buttons(label)) expect(b).toBeDisabled();
    }
  });
});
