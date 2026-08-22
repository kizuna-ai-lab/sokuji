import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EngineSurface } from './EngineSurface';
import type { EngineAdapter } from './EngineTypes';

let mockRichSelect = false;
vi.mock('../../../utils/supportsBaseSelect', () => ({
  supportsBaseSelect: () => mockRichSelect,
}));

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

const surface = (a = adapter(), effectiveMode: 'speaker' | 'participant' | 'both' = 'both') => render(
  <EngineSurface adapter={a} effectiveMode={effectiveMode}
    renderLibrary={(slot) => <div data-testid="library">{slot.stage}</div>}
    renderStorage={() => <div data-testid="storage" />} />);

const asrSelect = (index = 0) =>
  screen.getAllByRole('combobox', { name: /ASR/ })[index] as HTMLSelectElement;

describe('EngineSurface / EnginePage (dropdown form, 2026-08-23)', () => {
  it('renders both directions in "both" mode: speaker leg 3 selects, participant leg 2', () => {
    surface();
    expect(screen.getByText('ja → en')).toBeInTheDocument();
    expect(screen.getByText('en → ja')).toBeInTheDocument();
    expect(screen.getAllByRole('combobox', { name: /ASR/ })).toHaveLength(2);
    expect(screen.getAllByRole('combobox', { name: /TTS/ })).toHaveLength(1);
    expect(screen.getAllByRole('combobox')).toHaveLength(5);
  });

  it('the select lists Auto (with the resolved name) first, candidates with sizes, Browse library… last', () => {
    surface();
    const options = Array.from(asrSelect().options).map((o) => o.textContent);
    expect(options[0]).toBe('auto · Model One');
    expect(options[1]).toBe('Model One · 10 MB');
    expect(options[2]).toBe('Model Two');
    expect(options[3]).toBe('Browse library…');
  });

  it('picking a model writes the pick; picking Auto writes the empty string', () => {
    const a = adapter();
    surface(a);
    fireEvent.change(asrSelect(), { target: { value: 'm2' } });
    expect(a.select).toHaveBeenCalledWith({ dir: 'ja→en', stage: 'asr' }, 'm2');
    fireEvent.change(asrSelect(), { target: { value: '' } });
    expect(a.select).toHaveBeenCalledWith({ dir: 'ja→en', stage: 'asr' }, '');
  });

  it('an explicit pick renders as the select value; auto renders as ""', () => {
    const a = adapter({
      resolved: ({ stage }) =>
        stage === 'translation' ? { modelId: 'm2', source: 'explicit' } : { modelId: 'm1', source: 'auto' },
    });
    surface(a);
    const tr = screen.getAllByRole('combobox', { name: /Translation/ })[0] as HTMLSelectElement;
    expect(tr.value).toBe('m2');
    expect(asrSelect().value).toBe('');
  });

  it('a slot with no resolution carries the missing modifier and a plain Auto label', () => {
    surface();
    const tts = screen.getAllByRole('combobox', { name: /TTS/ })[0] as HTMLSelectElement;
    expect(tts.className).toContain('engine-slot__select--missing');
    expect(tts.options[0].textContent).toBe('Auto');
  });

  it('the Browse library option pushes the Library for THAT slot and keeps the selection', () => {
    const a = adapter();
    surface(a);
    fireEvent.change(asrSelect(), { target: { value: '__browse__' } });
    expect(screen.getByTestId('library')).toHaveTextContent('asr');
    expect(a.select).not.toHaveBeenCalled();
    // Back returns to the engine page with the select back on its value.
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(asrSelect().value).toBe('');
  });

  it('the back row shows the localized stage label as its VISIBLE text while "Back" survives as its accessible name', () => {
    surface();
    fireEvent.change(asrSelect(), { target: { value: '__browse__' } });
    const back = screen.getByRole('button', { name: 'Back' });
    expect(back).toHaveTextContent('Library · ASR');
    expect(back).not.toHaveTextContent('Back Library');
    expect(back.getAttribute('aria-label')).toBe('Back');
  });

  it('the storage footer pushes the storage page', () => {
    surface();
    fireEvent.click(screen.getByRole('button', { name: /Storage/ }));
    expect(screen.getByTestId('storage')).toBeInTheDocument();
  });

  it('disabled adapter renders every select disabled', () => {
    surface(adapter({ disabled: true }));
    for (const c of screen.getAllByRole('combobox')) expect(c).toBeDisabled();
  });

  it('speaker mode shows only the forward direction; participant only the reverse', () => {
    surface(adapter(), 'speaker');
    expect(screen.getByText('ja → en')).toBeInTheDocument();
    expect(screen.queryByText('en → ja')).not.toBeInTheDocument();
    expect(screen.getAllByRole('combobox')).toHaveLength(3);
  });

  it('participant mode shows only the reverse direction, with its 2-stage set', () => {
    surface(adapter(), 'participant');
    expect(screen.queryByText('ja → en')).not.toBeInTheDocument();
    expect(screen.getByText('en → ja')).toBeInTheDocument();
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(screen.queryByRole('combobox', { name: /TTS/ })).not.toBeInTheDocument();
  });

  it('rich mode (base-select): spans for name/meta, a selectedcontent mirror, and the browse action class', () => {
    mockRichSelect = true;
    try {
      surface();
      const select = asrSelect();
      // Closed-control mirror present.
      expect(select.querySelector('button > selectedcontent')).not.toBeNull();
      // Auto option: muted provenance prefix + name span.
      expect(select.options[0].querySelector('.engine-opt__auto')?.textContent).toBe('auto · ');
      // Candidate option: name and right-aligned meta as separate spans.
      const cand = select.options[1];
      expect(cand.querySelector('.engine-opt__name')?.textContent).toBe('Model One');
      expect(cand.querySelector('.engine-opt__meta')?.textContent).toBe('10 MB');
      // Browse option carries its action class.
      const browse = Array.from(select.options).find((o) => o.value === '__browse__')!;
      expect(browse.classList.contains('engine-opt--browse')).toBe(true);
    } finally {
      mockRichSelect = false;
    }
  });

  it('a mode switch kills a pending flash — revealing a direction later never replays it', () => {
    const props = {
      adapter: adapter(),
      renderLibrary: (slot: any) => <div data-testid="library">{slot.stage}</div>,
      renderStorage: () => <div data-testid="storage" />,
    };
    const { rerender } = render(
      <EngineSurface {...props} initialSlot={{ dir: 'en→ja', stage: 'asr' }} effectiveMode="both" />);
    expect(document.querySelector('.engine-slot.highlight')).toBeInTheDocument();

    rerender(<EngineSurface {...props} initialSlot={{ dir: 'en→ja', stage: 'asr' }} effectiveMode="speaker" />);
    expect(screen.queryByText('en → ja')).not.toBeInTheDocument();

    rerender(<EngineSurface {...props} initialSlot={{ dir: 'en→ja', stage: 'asr' }} effectiveMode="both" />);
    expect(screen.getByText('en → ja')).toBeInTheDocument();
    expect(document.querySelector('.engine-slot.highlight')).not.toBeInTheDocument();
  });

  it('returning from a pushed Library does not re-flash the deep-linked slot', () => {
    render(
      <EngineSurface adapter={adapter()} initialSlot={{ dir: 'ja→en', stage: 'asr' }} effectiveMode="both"
        renderLibrary={(slot) => <div data-testid="library">{slot.stage}</div>}
        renderStorage={() => <div data-testid="storage" />} />);

    expect(document.querySelector('.engine-slot.highlight')).toBeInTheDocument();

    fireEvent.change(asrSelect(), { target: { value: '__browse__' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(document.querySelector('.engine-slot.highlight')).not.toBeInTheDocument();
  });
});
