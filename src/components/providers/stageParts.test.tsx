// A provider's settings, cut by the stage they act on (mock v19, the owner's 2026-11-15 call): each stage card shows
// its own stage's; one acting on several of the stages the provider serves shows once, in the first of them, saying
// which stages it acts on.
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, d?: string, o?: Record<string, string>) => (d ?? _k).replace(/\{\{(\w+)\}\}/g, (_m, n: string) => o?.[n] ?? ''),
    i18n: { language: 'en' },
  }),
}));
import { render, screen, cleanup } from '@testing-library/react';
import { SettingsStage, StagePart } from './stageParts';
import type { RunStage } from '../../lib/lineup/types';

afterEach(() => cleanup());

const ALL: RunStage[] = ['transcription', 'translation', 'speech'];
const parts = (
  <>
    <StagePart stages={ALL}><span>Region</span></StagePart>
    <StagePart stages={['transcription']}><span>Speaker labels</span></StagePart>
    <StagePart stages={['transcription', 'translation']}><span>Background</span></StagePart>
    <StagePart stages={['speech']}><span>Voice</span></StagePart>
  </>
);
const shown = () => ['Region', 'Speaker labels', 'Background', 'Voice'].filter((n) => screen.queryByText(n));

describe('StagePart', () => {
  it('shows everything outside a stage card', () => {
    render(parts);
    expect(shown()).toEqual(['Region', 'Speaker labels', 'Background', 'Voice']);
  });

  it('shows a card its own stage, and in the first card the ones acting on several, saying which', () => {
    render(<SettingsStage stage="transcription" served={ALL}>{parts}</SettingsStage>);
    expect(shown()).toEqual(['Region', 'Speaker labels', 'Background']);
    expect(screen.getByText('Acts on transcription, translation and speech')).toBeInTheDocument();
    expect(screen.getByText('Acts on transcription and translation')).toBeInTheDocument();
  });

  it('keeps a later card to its own stage', () => {
    render(<SettingsStage stage="speech" served={ALL}>{parts}</SettingsStage>);
    expect(shown()).toEqual(['Voice']);
  });

  it('counts only the stages this provider serves: one left makes the setting that stage\'s own', () => {
    // Speech is someone else's: the region acts on transcription and translation here.
    const first = render(<SettingsStage stage="transcription" served={['transcription', 'translation']}>{parts}</SettingsStage>);
    // The region and the background both act on transcription and translation here.
    expect(screen.getAllByText('Acts on transcription and translation', { selector: '.stage-part__acts' })).toHaveLength(2);
    first.unmount();
    // Only transcription served: the region and the background are transcription's own, with no line.
    render(<SettingsStage stage="transcription" served={['transcription']}>{parts}</SettingsStage>);
    expect(shown()).toEqual(['Region', 'Speaker labels', 'Background']);
    expect(document.querySelector('.stage-part__acts')).toBeNull();
  });

  it('shows nothing that acts only on stages the provider does not serve', () => {
    render(<SettingsStage stage="transcription" served={['transcription']}>{<StagePart stages={['speech']}><span>Voice</span></StagePart>}</SettingsStage>);
    expect(screen.queryByText('Voice')).toBeNull();
  });
});
