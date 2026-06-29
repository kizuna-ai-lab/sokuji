import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LocalInferenceVoiceSection from './LocalInferenceVoiceSection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fb?: string) => fb ?? _k }),
}));
// Engine resolution drives which control renders.
vi.mock('../../../lib/local-inference/modelManifest', () => ({
  getManifestEntry: (id: string) => ({
    'edge-model': { engine: 'edge-tts' },
    'super-model': { engine: 'supertonic' },
    'matcha-model': { engine: 'matcha' },
  }[id]),
}));
// VoiceLibrarySection is covered by its own tests — stub to a marker + capture props.
let lastVLS: any = null;
vi.mock('./VoiceLibrarySection', () => ({
  __esModule: true,
  default: (props: any) => { lastVLS = props; return <div data-testid="vls" />; },
}));

const base = {
  isSessionActive: false,
  edgeVoices: [{ ShortName: 'en-US-A', label: 'A' }, { ShortName: 'en-US-B', label: 'B' }],
  edgeVoiceStatus: 'loaded' as const,
  edgeTtsVoice: 'en-US-A',
  supertonicVoices: [{ id: 'preset:0', label: 'Sarah', group: 'builtin' as const, removable: false }],
  supertonicSelectedId: 'preset:0',
  onImportVoice: vi.fn(), onRenameVoice: vi.fn(), onDeleteVoice: vi.fn(),
  ttsSpeakerId: 0, numSpeakers: 8,
  onUpdate: vi.fn(),
};

beforeEach(() => { lastVLS = null; vi.clearAllMocks(); });

describe('LocalInferenceVoiceSection', () => {
  it('edge engine → <select> writes edgeTtsVoice', () => {
    const onUpdate = vi.fn();
    render(<LocalInferenceVoiceSection {...base} ttsModel="edge-model" onUpdate={onUpdate} />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'en-US-B' } });
    expect(onUpdate).toHaveBeenCalledWith({ edgeTtsVoice: 'en-US-B' });
  });

  it('supertonic engine → renders VoiceLibrarySection with dropdown/upload capability', () => {
    render(<LocalInferenceVoiceSection {...base} ttsModel="super-model" />);
    expect(screen.getByTestId('vls')).toBeInTheDocument();
    expect(lastVLS.capability).toEqual({ importModes: ['upload'], curation: false, presentation: 'dropdown' });
    expect(lastVLS.selectedId).toBe('preset:0');
  });

  it('supertonic select writes ttsSpeakerId via sidFromVoiceId', () => {
    const onUpdate = vi.fn();
    render(<LocalInferenceVoiceSection {...base} ttsModel="super-model" onUpdate={onUpdate}
      supertonicVoices={[{ id: 'imported:7', label: 'Mine', group: 'custom', removable: true }]} />);
    lastVLS.onSelect('imported:7');
    expect(onUpdate).toHaveBeenCalledWith({ ttsSpeakerId: 7 });
  });

  it('other engine → speaker slider writes ttsSpeakerId', () => {
    const onUpdate = vi.fn();
    render(<LocalInferenceVoiceSection {...base} ttsModel="matcha-model" onUpdate={onUpdate} />);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '3' } });
    expect(onUpdate).toHaveBeenCalledWith({ ttsSpeakerId: 3 });
  });
});
