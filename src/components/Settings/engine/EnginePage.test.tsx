import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EngineSurface } from './EngineSurface';
import type { EngineAdapter } from './EngineTypes';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string, options?: Record<string, string>) => {
      if (options) {
        let result = defaultValue || key;
        Object.entries(options).forEach(([k, v]) => {
          result = result.replace(`{{${k}}}`, v);
        });
        return result;
      }
      return defaultValue || key;
    },
  }),
}));

const adapter = (over: Partial<EngineAdapter> = {}): EngineAdapter => ({
  directions: [
    { dir: 'ja→en', src: 'ja', tgt: 'en' },
    { dir: 'en→ja', src: 'en', tgt: 'ja' },
  ],
  resolved: ({ stage }) => (stage === 'tts' ? null : { modelId: 'm1', source: 'auto' }),
  displayName: (id) => (id === 'm1' ? 'Model One' : id),
  languageName: (code) => code,
  readyCandidates: () => [{ id: 'm1', name: 'Model One', sizeLabel: '10 MB' }, { id: 'm2', name: 'Model Two' }],
  select: vi.fn(),
  storageSummary: '796 MB used',
  stagesFor: (_dir, isSpeaker) => (isSpeaker ? ['asr', 'translation', 'tts'] : ['asr', 'translation']),
  disabled: false,
  ...over,
});

const surface = (a = adapter()) => render(
  <EngineSurface adapter={a}
    renderLibrary={(slot) => <div data-testid="library">{slot.stage}</div>}
    renderStorage={() => <div data-testid="storage" />} />);

describe('EngineSurface / EnginePage', () => {
  it('renders both directions, speaker with 3 slots, participant with 2', () => {
    surface();
    expect(screen.getByText('ja → en')).toBeInTheDocument();
    expect(screen.getByText('en → ja')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /ASR/ })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /TTS/ })).toHaveLength(1);
  });

  it('single-open: expanding one slot collapses the previously open one', () => {
    surface();
    const [asrSpeaker, asrParticipant] = screen.getAllByRole('button', { name: /ASR/ });
    fireEvent.click(asrSpeaker);
    expect(screen.getAllByRole('radio').length).toBeGreaterThan(0); // picker open
    fireEvent.click(asrParticipant);
    // still exactly one expanded body
    expect(document.querySelectorAll('.engine-slot__body')).toHaveLength(1);
  });

  it('the expanded picker lists ready candidates + the Auto row, and writes a pick', () => {
    const a = adapter();
    surface(a);
    fireEvent.click(screen.getAllByRole('button', { name: /ASR/ })[0]);
    expect(screen.getByRole('radio', { name: /Auto/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Model Two/ }));
    expect(a.select).toHaveBeenCalledWith({ dir: 'ja→en', stage: 'asr' }, 'm2');
  });

  it('the browse affordance carries no count', () => {
    surface();
    fireEvent.click(screen.getAllByRole('button', { name: /ASR/ })[0]);
    const browse = screen.getByRole('button', { name: /Browse library/ });
    expect(browse.textContent).not.toMatch(/\d/);
  });

  it('browse pushes the library with an in-content back row; back returns', () => {
    surface();
    fireEvent.click(screen.getAllByRole('button', { name: /ASR/ })[0]);
    fireEvent.click(screen.getByRole('button', { name: /Browse library/ }));
    expect(screen.getByTestId('library')).toHaveTextContent('asr');
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(screen.queryByTestId('library')).not.toBeInTheDocument();
    expect(screen.getByText('ja → en')).toBeInTheDocument();
  });

  it('the back row shows the localized stage label as its VISIBLE text (not the word "Back", not the raw stage string), while "Back" survives as its accessible name', () => {
    surface();
    fireEvent.click(screen.getAllByRole('button', { name: /ASR/ })[0]);
    fireEvent.click(screen.getByRole('button', { name: /Browse library/ }));
    const back = screen.getByRole('button', { name: 'Back' });
    expect(back).toHaveTextContent('Library · ASR');
    expect(back).not.toHaveTextContent('Back Library');
    expect(back).not.toHaveTextContent('asr');
    expect(back.getAttribute('aria-label')).toBe('Back');
  });

  it('the storage row pushes the storage page', () => {
    surface();
    fireEvent.click(screen.getByRole('button', { name: /Storage/ }));
    expect(screen.getByTestId('storage')).toBeInTheDocument();
  });

  it('disabled adapter renders pickers disabled', () => {
    surface(adapter({ disabled: true }));
    fireEvent.click(screen.getAllByRole('button', { name: /ASR/ })[0]);
    for (const r of screen.getAllByRole('radio')) expect(r).toBeDisabled();
  });

  it('returning from a pushed Library does not re-flash the deep-linked slot', () => {
    // Pushing unmounts the slot rows; if the flash signal were the raw
    // initialSlot prop, remounting on pop would re-run every row's flash
    // effect against the still-truthy object and flash the slot again.
    render(
      <EngineSurface adapter={adapter()} initialSlot={{ dir: 'ja→en', stage: 'asr' }}
        renderLibrary={(slot) => <div data-testid="library">{slot.stage}</div>}
        renderStorage={() => <div data-testid="storage" />} />);

    // The deep-link itself flashes the target slot…
    expect(document.querySelector('.engine-slot.highlight')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Browse library/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    // …but coming back from the Library must not flash it again.
    expect(document.querySelector('.engine-slot.highlight')).not.toBeInTheDocument();
  });
});
