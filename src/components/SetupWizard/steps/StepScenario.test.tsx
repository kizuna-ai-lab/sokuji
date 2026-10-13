import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// Mutable so one file can render the card on the desktop app and elsewhere.
const platform = vi.hoisted(() => ({ electron: true }));
vi.mock('../../../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isElectron: () => platform.electron,
}));
vi.mock('react-i18next', async (orig) => ({
  ...(await orig<any>()),
  useTranslation: () => ({
    t: (k: string, d?: string | object) => (typeof d === 'string' ? d : k),
  }),
}));

import StepScenario from './StepScenario';
import { initialDraft } from '../setupDraft';

const faceToFaceText = () =>
  screen.getByText('Face-to-face conversation, subtitles only').closest('label') as HTMLElement;

describe('StepScenario', () => {
  afterEach(() => {
    cleanup();
    platform.electron = true;
  });

  it('offers the LAN caption page on the face-to-face subtitles card in the desktop app', () => {
    render(<StepScenario draft={initialDraft()} dispatch={vi.fn()} />);
    expect(faceToFaceText().textContent).toContain('the LAN caption page');
  });

  it('leaves the LAN caption page out where caption sharing does not exist', () => {
    platform.electron = false;
    render(<StepScenario draft={initialDraft()} dispatch={vi.fn()} />);
    expect(faceToFaceText().textContent).toContain('Both read the same screen.');
    expect(faceToFaceText().textContent).not.toContain('LAN');
  });

  it("says the two-way voice card can read the other side to me, as its preset turns Translation I hear on", () => {
    // "Can": the wizard has no source step, so whether it plays (one application, not all system sound) is the language step's to say.
    render(<StepScenario draft={initialDraft()} dispatch={vi.fn()} />);
    const card = screen.getByText('Two-way online conversation').closest('label') as HTMLElement;
    expect(card.textContent).toContain('you read theirs as subtitles and can hear it too');
    expect(card.textContent).not.toContain('you hear theirs');
  });
});
