import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import type { AuthContext, PreviewPort } from '../../lib/provider/types';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { PalabraSettingsView, PalabraVoiceSummary } from './PalabraSettings';
import { PALABRA_DEFAULTS } from './settings';

const slider = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
/** The voice picker's trigger inside a labelled row, by class (floating-ui's guards sit beside it while open). */
const trigger = (root: HTMLElement = document.body) => root.querySelector('.voice-picker__trigger') as HTMLElement;
const inGrid = () => within(screen.getByRole('grid'));
const buttons = (label: string) => within(screen.getByRole('group', { name: label })).getAllByRole('button');

describe("Palabra AI's settings view (D18)", () => {
  it('draws, in the old order, the voice, speech processing and the audio buffer, and nothing in English of its own (ruling 10)', () => {
    const { container } = render(<PalabraSettingsView settings={PALABRA_DEFAULTS} update={vi.fn()} />);
    // The voice library replaces the two-option select (voice library spec §5).
    expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual(['settings.voiceSettings', 'settings.speechProcessing', 'settings.queueConfiguration']);
    expect(container.querySelector('select[aria-label="settings.voice"]')).toBeNull();
    expect(trigger()).toHaveTextContent('Default Low');
    fireEvent.click(trigger());
    expect(inGrid().getByRole('button', { name: 'Default Low' })).toBeInTheDocument();
    expect(inGrid().getByRole('button', { name: 'Default High' })).toBeInTheDocument();
    fireEvent.click(trigger());
    // The old three `title` tooltips, English-only, are gone.
    expect(container.querySelectorAll('.settings-section [title]:not(.voice-picker *)')).toHaveLength(0);
  });

  it('writes the voice and each switch to its own field', () => {
    const update = vi.fn();
    render(<PalabraSettingsView settings={PALABRA_DEFAULTS} update={update} />);
    fireEvent.click(trigger());
    fireEvent.click(inGrid().getByRole('button', { name: 'Default High' }));
    fireEvent.click(buttons('settings.sentenceSplitter')[1]);
    fireEvent.click(buttons('settings.translatePartialTranscriptions')[0]);
    fireEvent.click(buttons('settings.autoTempo')[0]);
    expect(update.mock.calls).toEqual([
      [{ voiceId: 'default_high', voiceName: 'Default High' }], [{ sentenceSplitterEnabled: false }], [{ translatePartialTranscriptions: true }], [{ autoTempo: true }],
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
    fireEvent.click(trigger());
    expect(inGrid().getByRole('button', { name: 'Default High' })).toBeDisabled();
    fireEvent.click(trigger());
    expect(slider('settings.desiredQueueLevel')).toBeDisabled();
    expect(slider('settings.maxQueueLevel')).toBeDisabled();
    for (const label of ['settings.sentenceSplitter', 'settings.translatePartialTranscriptions', 'settings.autoTempo']) {
      for (const b of buttons(label)) expect(b).toBeDisabled();
    }
  });
});

describe('PalabraVoiceSummary', () => {
  it("names each leg's voice as a run speaks it: the other party's never mine", () => {
    const text = (settings: Partial<typeof PALABRA_DEFAULTS>, leg: 'speaker' | 'participant') =>
      render(<PalabraVoiceSummary settings={{ ...PALABRA_DEFAULTS, ...settings }} update={() => {}} leg={leg} />).container.textContent;
    expect(text({}, 'speaker')).toBe('Default Low');
    expect(text({}, 'participant')).toBe('Default High');
    expect(text({ voiceId: 'default_high' }, 'participant')).toBe('Default Low');
  });
});

describe('PalabraSettingsView, the participant spoken', () => {
  it('shows two labelled pickers, writing each its own field with its name', () => {
    const update = vi.fn();
    render(<PalabraSettingsView settings={PALABRA_DEFAULTS} update={update} participantSpeaks />);
    fireEvent.click(trigger(screen.getByRole('group', { name: 'settings.voiceTheyHear' })));
    fireEvent.click(inGrid().getByRole('button', { name: 'Default High' }));
    fireEvent.click(trigger(screen.getByRole('group', { name: 'settings.voiceIHear' })));
    fireEvent.click(inGrid().getByRole('button', { name: 'Default Low' }));
    expect(update.mock.calls).toEqual([
      [{ voiceId: 'default_high', voiceName: 'Default High' }],
      [{ participantVoiceId: 'default_low', participantVoiceName: 'Default Low' }],
    ]);
  });
});

describe('PalabraSettingsView, the voice library wired to the account', () => {
  it('lists the account\'s voices with its credentials and previews through the host\'s route', async () => {
    const sample = 'https://cdn.palabra.ai/blob/hu-m.mp3';
    const page = (items: unknown[]) => new Response(JSON.stringify({ ok: true, data: { items, page_size: 100, count: items.length, next: null } }));
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === sample) return new Response(new Uint8Array([1, 2, 3]));
      if (url.includes('/saas/voice/limits')) return new Response(JSON.stringify({ ok: true, data: { total: 0, limit: 10, remaining: 10 } }));
      if (url.includes('/saas/voice/builtin')) {
        return page([{ voice_id: 'hu-m', voice_type: 'instantly_cloned_builtin', name: 'Hungarian Male', labels: { gender: 'Male' }, tts_sample: { url: sample, text: { lang: 'hu' } }, tts_samples: [] }]);
      }
      return page([]);
    });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('AudioContext', function AudioContext() {
      return {
        decodeAudioData: vi.fn().mockResolvedValue({ numberOfChannels: 1, length: 4, sampleRate: 22050, getChannelData: () => new Float32Array(4) }),
        close: vi.fn().mockResolvedValue(undefined),
      };
    });
    const preview: PreviewPort = { play: vi.fn(async () => {}), stop: vi.fn() };
    const account = { credentials: { apiKey: 'plbr_test', clientId: '', clientSecret: '' }, auth: { signedIn: false, getToken: async () => null } as AuthContext };
    try {
      render(<PalabraSettingsView settings={PALABRA_DEFAULTS} update={vi.fn()} account={account} preview={preview} pair={{ source: 'en', target: 'hu' }} />);
      fireEvent.click(trigger());
      await waitFor(() => expect(inGrid().getByRole('button', { name: 'Hungarian Male' })).toBeInTheDocument());
      const headers = (fetch.mock.calls as unknown as Array<[string, RequestInit]>).filter(([u]) => u.includes('api.palabra.ai')).map(([, i]) => i.headers as Record<string, string>);
      expect(headers.every((h) => h.Authorization === 'Bearer plbr_test')).toBe(true);
      const row = inGrid().getByRole('button', { name: 'Hungarian Male' }).closest('[role="row"]') as HTMLElement;
      fireEvent.click(within(row).getAllByRole('button').find((b) => /play/i.test(b.getAttribute('aria-label') ?? ''))!);
      await waitFor(() => expect(preview.play).toHaveBeenCalledTimes(1));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
