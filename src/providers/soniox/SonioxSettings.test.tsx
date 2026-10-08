import { useContext } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VoicePreviewContext } from '../../components/providers/VoicePreviewContext';
import type { ProviderAccount, PreviewPort, SettingsProps } from '../../lib/provider/types';
import type { SonioxVoiceSectionProps } from '../../components/Settings/sections/SonioxVoiceSection';
import { SONIOX_DEFAULTS, type SonioxSettings } from './settings';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key) }) };
});

// Captured instead of rendered: floating-ui's Tooltip opens only on hover
// (SpeechSection.test.tsx:16-21's pattern).
const tooltipContents: unknown[] = [];
vi.mock('../../components/Tooltip/Tooltip', () => ({
  default: ({ content }: { content: unknown }) => {
    tooltipContents.push(content);
    return null;
  },
}));

const seenVoiceSection: SonioxVoiceSectionProps[] = [];
const seenPort: Array<PreviewPort | null> = [];
function Probe() {
  seenPort.push(useContext(VoicePreviewContext));
  return null;
}
vi.mock('../../components/Settings/sections/SonioxVoiceSection', () => ({
  default: (props: SonioxVoiceSectionProps) => {
    seenVoiceSection.push(props);
    return <Probe />;
  },
}));

import { createSonioxSettingsView } from './SonioxSettings';

const account = (credentials: Record<string, string>): ProviderAccount => ({
  credentials,
  auth: { signedIn: false, getToken: async () => null },
});

const BYOK = createSonioxSettingsView({ managed: false, useVoiceSource: () => null });

const props = (patch: Partial<SettingsProps<SonioxSettings>> = {}): SettingsProps<SonioxSettings> => ({
  settings: SONIOX_DEFAULTS,
  update: vi.fn(),
  pair: { source: 'ja', target: 'en' },
  account: account({ apiKey: 'k' }),
  legs: ['speaker', 'participant'] as const,
  ...patch,
});

beforeEach(() => {
  tooltipContents.length = 0;
  seenVoiceSection.length = 0;
  seenPort.length = 0;
});

describe('createSonioxSettingsView', () => {
  it('writes the region, and locks it while a run is on', () => {
    const update = vi.fn();
    const { rerender } = render(<BYOK {...props({ update })} />);
    const select = screen.getByLabelText('Region') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toEqual(['United States', 'European Union', '日本 (Japan)']);
    fireEvent.change(select, { target: { value: 'eu' } });
    expect(update).toHaveBeenCalledWith({ region: 'eu' });
    expect(select.disabled).toBe(false);

    rerender(<BYOK {...props({ update, disabled: true })} />);
    expect(screen.getByLabelText('Region')).toBeDisabled();
  });

  it('the TTS speed runs 0.7–1.3 in 0.05 steps and writes a number', () => {
    const update = vi.fn();
    render(<BYOK {...props({ update })} />);
    const slider = screen.getByLabelText('Speech Speed') as HTMLInputElement;
    expect(slider.min).toBe('0.7');
    expect(slider.max).toBe('1.3');
    expect(slider.step).toBe('0.05');
    fireEvent.change(slider, { target: { value: '0.85' } });
    expect(update).toHaveBeenCalledWith({ ttsSpeed: 0.85 });
  });

  it('the vocabulary and background are 4 000-character textareas that write what is typed', () => {
    const update = vi.fn();
    render(<BYOK {...props({ update })} />);
    const cases: Array<[string, keyof SonioxSettings]> = [
      ['Terms', 'vocabularyTerms'],
      ['Preferred Translations', 'vocabularyTranslations'],
      ['Session Background', 'contextText'],
    ];
    for (const [label, field] of cases) {
      const el = screen.getByLabelText(label) as HTMLTextAreaElement;
      expect(el.maxLength).toBe(4000);
      fireEvent.change(el, { target: { value: 'x' } });
      expect(update).toHaveBeenCalledWith({ [field]: 'x' });
    }
  });

  it('Terms and Preferred Translations each draw their own tooltip', () => {
    render(<BYOK {...props()} />);
    expect(tooltipContents).toContain('Improves recognition of uncommon words — names, jargon, product names.');
    expect(tooltipContents).toContain(
      "Biases how specific terms are translated — a preference, not a guaranteed replacement: names with an established rendering work best, while common words may keep the model's own wording. Entries are directional; the reverse direction only exists in Both mode, where you can add a reverse line."
    );
  });

  it('the shared-session pills write the choice, and are locked outside Both mode or while a run is on', () => {
    const update = vi.fn();
    const { rerender } = render(<BYOK {...props({ update })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enabled' }));
    expect(update).toHaveBeenCalledWith({ bothModeSharedSession: true });
    fireEvent.click(screen.getByRole('button', { name: 'Disabled' }));
    expect(update).toHaveBeenCalledWith({ bothModeSharedSession: false });
    expect(screen.getByRole('button', { name: 'Enabled' })).not.toBeDisabled();

    rerender(<BYOK {...props({ update, legs: ['speaker'] })} />);
    expect(screen.getByRole('button', { name: 'Enabled' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Disabled' })).toBeDisabled();

    rerender(<BYOK {...props({ update, disabled: true })} />);
    expect(screen.getByRole('button', { name: 'Enabled' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Disabled' })).toBeDisabled();
  });

  it('an own key reads the own-key region tooltip and no managed cost note', () => {
    render(<BYOK {...props()} />);
    expect(tooltipContents).toContain(
      'Soniox runs a separate deployment per region, and each one is a separate Soniox project with its own API key. Your audio is processed in the region you pick. Applies from the next session.'
    );
    expect(screen.queryByText(/Kizuna AI supports both\./)).toBeNull();
  });

  it("a managed view reads the managed region tooltip and states the cost of split (Plan B's seam)", () => {
    const Managed = createSonioxSettingsView({ managed: true, useVoiceSource: () => null });
    render(<Managed {...props()} />);
    expect(tooltipContents).toContain(
      'Soniox runs a separate deployment per region. Your audio is processed in the region you pick. Applies from the next session.'
    );
    expect(screen.getByText(/Kizuna AI supports both\./)).toBeInTheDocument();
  });

  it("hands the voice library the host's preview route", () => {
    const port: PreviewPort = { play: vi.fn(), stop: vi.fn() };
    const { rerender } = render(<BYOK {...props({ preview: port })} />);
    expect(seenPort[seenPort.length - 1]).toBe(port);
    rerender(<BYOK {...props()} />);
    expect(seenPort[seenPort.length - 1]).toBeNull();
  });
});

describe('SonioxSettings, face-to-face', () => {
  it("shows the other party's voice only when the participant speaks, built-in voices only", () => {
    const update = vi.fn();
    const { rerender } = render(<BYOK {...props({ update })} />);
    expect(screen.queryByLabelText("Other party's voice")).toBeNull();
    rerender(<BYOK {...props({ update, participantSpeaks: true })} />);
    const select = screen.getByLabelText("Other party's voice") as HTMLSelectElement;
    expect(select.value).toBe('Grace');
    expect([...select.options].map((o) => o.value)).toContain('Kenji');
    fireEvent.change(select, { target: { value: 'Kenji' } });
    expect(update).toHaveBeenCalledWith({ participantVoice: 'Kenji' });
  });

  it('locks the shared-session pills in face-to-face and says why', () => {
    render(<BYOK {...props({ faceToFace: true, legs: ['speaker', 'participant'] })} />);
    expect(screen.getByRole('button', { name: 'Enabled' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Disabled' })).toBeDisabled();
    expect(screen.getByText(/Face-to-face always uses one shared session/)).toBeInTheDocument();
  });

  it('shows the forced value in face-to-face, not the stored one', () => {
    render(<BYOK {...props({ faceToFace: true, settings: { ...SONIOX_DEFAULTS, bothModeSharedSession: false } })} />);
    expect(screen.getByRole('button', { name: 'Enabled' })).toHaveClass('active');
    expect(screen.getByRole('button', { name: 'Disabled' })).not.toHaveClass('active');
  });
});
