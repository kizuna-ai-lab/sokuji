import { useContext } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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

/** A section's own controls: the shared-session and speaker-labels pills are both named Enabled / Disabled. */
const section = (id: string) => within(document.getElementById(id)!);
const sharedPills = () => section('soniox-settings-section');
const labelsSection = () => document.getElementById('soniox-speaker-labels-section');

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
    fireEvent.click(sharedPills().getByRole('button', { name: 'Enabled' }));
    expect(update).toHaveBeenCalledWith({ bothModeSharedSession: true });
    fireEvent.click(sharedPills().getByRole('button', { name: 'Disabled' }));
    expect(update).toHaveBeenCalledWith({ bothModeSharedSession: false });
    expect(sharedPills().getByRole('button', { name: 'Enabled' })).not.toBeDisabled();

    rerender(<BYOK {...props({ update, legs: ['speaker'] })} />);
    expect(sharedPills().getByRole('button', { name: 'Enabled' })).toBeDisabled();
    expect(sharedPills().getByRole('button', { name: 'Disabled' })).toBeDisabled();

    rerender(<BYOK {...props({ update, disabled: true })} />);
    expect(sharedPills().getByRole('button', { name: 'Enabled' })).toBeDisabled();
    expect(sharedPills().getByRole('button', { name: 'Disabled' })).toBeDisabled();
  });

  const SHARED_HELP = 'Both mode can run on one shared Soniox session or a separate session per direction.\n\nEnabled: a single session translates both sides with automatic speaker separation — lower cost and latency.\n\nDisabled: a separate session per direction — more reliable when both people talk at once, but about twice the cost.\n\nOnly affects Both mode.';
  const MANAGED_COST = 'Kizuna AI supports both. Disabled runs two sessions at once — about twice the cost per minute, so your session allowance runs out in about half the time and a higher balance is needed to start.';
  const mentionsCost = (c: unknown) => typeof c === 'string' && c.includes('Kizuna AI supports both.');

  it('an own key reads the own-key region tooltip, and the shared-session help without the managed cost note', () => {
    render(<BYOK {...props()} />);
    expect(tooltipContents).toContain(
      'Soniox runs a separate deployment per region, and each one is a separate Soniox project with its own API key. Your audio is processed in the region you pick. Applies from the next session.'
    );
    expect(tooltipContents).toContain(SHARED_HELP);
    expect(tooltipContents.some(mentionsCost)).toBe(false);
    expect(screen.queryByText(/Kizuna AI supports both\./)).toBeNull();
  });

  it("a managed view reads the managed region tooltip and states the cost of split in the shared-session help, not as a block of its own (Plan B's seam)", () => {
    const Managed = createSonioxSettingsView({ managed: true, useVoiceSource: () => null });
    render(<Managed {...props()} />);
    expect(tooltipContents).toContain(
      'Soniox runs a separate deployment per region. Your audio is processed in the region you pick. Applies from the next session.'
    );
    expect(tooltipContents).toContain(`${SHARED_HELP}\n\n${MANAGED_COST}`);
    expect(tooltipContents).not.toContain(SHARED_HELP);
    expect(screen.queryByText(/Kizuna AI supports both\./)).toBeNull();
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
  it("hands the voice library the other party's voice only when the participant speaks, read in the pair's source; no section of its own", () => {
    const update = vi.fn();
    const { rerender, container } = render(<BYOK {...props({ update })} />);
    expect(seenVoiceSection[seenVoiceSection.length - 1].participant).toBeUndefined();
    rerender(<BYOK {...props({ update, participantSpeaks: true })} />);
    const p = seenVoiceSection[seenVoiceSection.length - 1].participant!;
    expect(p).toMatchObject({ voice: 'Grace', language: 'ja' });
    p.onSelect('Kenji');
    expect(update).toHaveBeenCalledWith({ participantVoice: 'Kenji' });
    expect(container.querySelectorAll('select')).toHaveLength(1); // the region's
  });

  it('locks the shared-session pills in face-to-face and says why', () => {
    render(<BYOK {...props({ faceToFace: true, legs: ['speaker', 'participant'] })} />);
    expect(sharedPills().getByRole('button', { name: 'Enabled' })).toBeDisabled();
    expect(sharedPills().getByRole('button', { name: 'Disabled' })).toBeDisabled();
    expect(screen.getByText(/Face-to-face always uses one shared session/)).toBeInTheDocument();
  });

  it('shows the forced value in face-to-face, not the stored one', () => {
    render(<BYOK {...props({ faceToFace: true, settings: { ...SONIOX_DEFAULTS, bothModeSharedSession: false } })} />);
    expect(sharedPills().getByRole('button', { name: 'Enabled' })).toHaveClass('active');
    expect(sharedPills().getByRole('button', { name: 'Disabled' })).not.toHaveClass('active');
  });
});

describe('SonioxSettings, speaker labels', () => {
  it('the speaker-labels pills show the stored choice, write it, and are locked while a run is on', () => {
    const update = vi.fn();
    const { rerender } = render(<BYOK {...props({ update })} />);
    const pills = section('soniox-speaker-labels-section');
    expect(pills.getByRole('button', { name: 'Enabled' })).toHaveClass('active');
    expect(pills.getByRole('button', { name: 'Disabled' })).not.toHaveClass('active');
    fireEvent.click(pills.getByRole('button', { name: 'Disabled' }));
    expect(update).toHaveBeenCalledWith({ speakerLabels: false });
    fireEvent.click(pills.getByRole('button', { name: 'Enabled' }));
    expect(update).toHaveBeenCalledWith({ speakerLabels: true });

    rerender(<BYOK {...props({ update, settings: { ...SONIOX_DEFAULTS, speakerLabels: false }, disabled: true })} />);
    const locked = section('soniox-speaker-labels-section');
    expect(locked.getByRole('button', { name: 'Disabled' })).toHaveClass('active');
    expect(locked.getByRole('button', { name: 'Enabled' })).toBeDisabled();
    expect(locked.getByRole('button', { name: 'Disabled' })).toBeDisabled();
  });

  it("is shown only where the other side's people are heard: Others and Both, never my leg alone or face-to-face", () => {
    const { rerender } = render(<BYOK {...props({ legs: ['participant'] })} />);
    expect(labelsSection()).not.toBeNull();
    rerender(<BYOK {...props()} />);
    expect(labelsSection()).not.toBeNull();
    rerender(<BYOK {...props({ legs: ['speaker'] })} />);
    expect(labelsSection()).toBeNull();
    rerender(<BYOK {...props({ faceToFace: true })} />);
    expect(labelsSection()).toBeNull();
    rerender(<BYOK {...props({ legs: undefined })} />);
    expect(labelsSection()).toBeNull();
  });
});

// Spec 2026-11-05 §4.4: Soniox's own setting, in the view own-key and managed share, each flavour with its own stored value.
describe.each([
  ['own key', BYOK],
  ['managed', createSonioxSettingsView({ managed: true, useVoiceSource: () => null })],
] as const)('SonioxSettings, use the read-aloud text to improve recognition (%s)', (_flavour, View) => {
  const HELP = 'Tells the recognition service what is about to be read aloud, so it recognizes replies better and leaves the read-aloud out of the transcript if your speakers reach the microphone. When speech plays on this computer, this adds a small charge.';
  const SPLIT_BOTH = 'Off in two-way mode with separate sessions: there it did not keep the read-aloud out of recognition and made it harder to recognize someone talking over it. Your setting is kept.';
  const rowOf = () => section('soniox-agent-text-section');
  const on = () => rowOf().getByRole('button', { name: 'Enabled' });
  const off = () => rowOf().getByRole('button', { name: 'Disabled' });
  const control = () => document.querySelector('#soniox-agent-text-section .turn-detection-options')!;
  const withSettings = (patch: Partial<SonioxSettings>) => ({ ...SONIOX_DEFAULTS, ...patch });

  it('sits directly below the shared-session choice, under its own heading', () => {
    render(<View {...props()} />);
    expect(document.getElementById('soniox-settings-section')!.nextElementSibling?.id).toBe('soniox-agent-text-section');
    expect(rowOf().getByRole('heading', { name: 'Use the read-aloud text to improve recognition' })).toBeInTheDocument();
  });

  it('in shared Both: shows the stored value, writes it, says what it is for and that it adds a small charge, with no reason', () => {
    const update = vi.fn();
    const { rerender } = render(<View {...props({ update, settings: withSettings({ bothModeSharedSession: true }) })} />);
    expect(on()).toHaveClass('active');
    expect(off()).not.toHaveClass('active');
    expect(on()).not.toBeDisabled();
    fireEvent.click(off());
    expect(update).toHaveBeenCalledWith({ agentText: false });
    fireEvent.click(on());
    expect(update).toHaveBeenCalledWith({ agentText: true });
    expect(tooltipContents).toContain(HELP);
    expect(tooltipContents).not.toContain(`${HELP}\n${SPLIT_BOTH}`);
    expect(control().getAttribute('title')).toBeNull();

    rerender(<View {...props({ update, settings: withSettings({ bothModeSharedSession: true, agentText: false }) })} />);
    expect(off()).toHaveClass('active');
    expect(on()).not.toHaveClass('active');
  });

  it('in face-to-face: live, whatever the shared-session choice says', () => {
    const update = vi.fn();
    render(<View {...props({ update, faceToFace: true, settings: withSettings({ bothModeSharedSession: false }) })} />);
    expect(on()).toHaveClass('active');
    expect(off()).not.toBeDisabled();
    fireEvent.click(off());
    expect(update).toHaveBeenCalledWith({ agentText: false });
    expect(control().getAttribute('title')).toBeNull();
  });

  it('outside Both: live, whatever the shared-session choice says', () => {
    for (const legs of [['speaker'], ['participant'], undefined] as const) {
      const update = vi.fn();
      const { unmount } = render(<View {...props({ update, legs, settings: withSettings({ bothModeSharedSession: false }) })} />);
      expect(on(), String(legs)).toHaveClass('active');
      expect(off(), String(legs)).not.toBeDisabled();
      fireEvent.click(off());
      expect(update, String(legs)).toHaveBeenCalledWith({ agentText: false });
      expect(control().getAttribute('title'), String(legs)).toBeNull();
      unmount();
    }
  });

  it('in split Both: shows off, greyed and not changeable, says why in its help and its title, and keeps the stored value', () => {
    const update = vi.fn();
    render(<View {...props({ update, settings: withSettings({ bothModeSharedSession: false, agentText: true }) })} />);
    expect(off()).toHaveClass('active');
    expect(on()).not.toHaveClass('active');
    expect(on()).toBeDisabled();
    expect(off()).toBeDisabled();
    fireEvent.click(on());
    fireEvent.click(off());
    expect(update).not.toHaveBeenCalled();
    expect(control().getAttribute('title')).toBe(SPLIT_BOTH);
    expect(tooltipContents).toContain(`${HELP}\n${SPLIT_BOTH}`);
  });

  it('is disabled while the other Soniox settings are, still showing the stored value', () => {
    const update = vi.fn();
    render(<View {...props({ update, disabled: true, settings: withSettings({ bothModeSharedSession: true, agentText: true }) })} />);
    expect(on()).toHaveClass('active');
    expect(on()).toBeDisabled();
    expect(off()).toBeDisabled();
    fireEvent.click(off());
    expect(update).not.toHaveBeenCalled();
    expect(control().getAttribute('title')).toBeNull();
  });
});
