// src/components/VbCable/VbCableIntro.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { VbCablePresence } from '../../lib/audio/vbCable';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
const presence = vi.hoisted(() => ({ value: 'missing' as VbCablePresence }));
vi.mock('../../stores/vbCableStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../stores/vbCableStore')>()),
  useVbCablePresence: () => presence.value,
}));
const tour = vi.hoisted(() => ({ active: false }));
vi.mock('../Tour/TourProvider', () => ({ useTour: () => ({ active: tour.active }) }));
const speech = vi.hoisted(() => ({ other: true, faceToFace: false }));
vi.mock('../../lib/session/appShape', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/session/appShape')>()),
  speechFromStores: () => ({ other: speech.other, me: false, them: false }),
  faceToFaceFromStores: () => speech.faceToFace,
}));
vi.mock('./VbCableNotice', () => ({
  default: ({ variant, onNotNow }: { variant: string; onNotNow?: () => void }) => (
    <div data-testid={`notice-${variant}`}><button type="button" onClick={onNotNow}>not-now</button></div>
  ),
}));

import { useVbCableStore, type VbCableState } from '../../stores/vbCableStore';
import VbCableIntro from './VbCableIntro';

const actions = { load: vi.fn(async () => {}), install: vi.fn(async () => {}), checkAgain: vi.fn(async () => {}), dismissReady: vi.fn(), markIntroSeen: vi.fn() };
const state = (s: Partial<VbCableState>) => useVbCableStore.setState({ channel: 'website', introSeen: false, attempt: 'none', readyDismissed: false, ...actions, ...s });
const dialog = () => screen.queryByRole('dialog');

beforeEach(() => {
  presence.value = 'missing';
  tour.active = false;
  speech.other = true;
  speech.faceToFace = false;
  Object.values(actions).forEach((a) => a.mockClear());
  state({});
});

describe('VbCableIntro', () => {
  it('opens once VB-CABLE is missing and the translation is spoken into the virtual microphone', () => {
    render(<VbCableIntro />);
    expect(dialog()).toBeInTheDocument();
    expect(screen.getByTestId('notice-modal')).toBeInTheDocument();
  });

  it('opens in the Store build too, with the notice deciding what to offer', () => {
    state({ channel: 'store' });
    render(<VbCableIntro />);
    expect(dialog()).toBeInTheDocument();
  });

  it('stays shut when seen, not yet loaded, or the channel is unknown', () => {
    for (const s of [{ introSeen: true }, { introSeen: null }, { channel: null }] as Partial<VbCableState>[]) {
      state(s);
      const { unmount } = render(<VbCableIntro />);
      expect(dialog()).toBeNull();
      unmount();
    }
  });

  it('stays shut when the translation is not spoken, in face-to-face, or while the list is unknown or VB-CABLE is there', () => {
    speech.other = false;
    let r = render(<VbCableIntro />);
    expect(dialog()).toBeNull();
    r.unmount();
    speech.other = true;
    speech.faceToFace = true;
    r = render(<VbCableIntro />);
    expect(dialog()).toBeNull();
    r.unmount();
    speech.faceToFace = false;
    for (const p of ['unknown', 'present', 'not-applicable'] as const) {
      presence.value = p;
      r = render(<VbCableIntro />);
      expect(dialog()).toBeNull();
      r.unmount();
    }
  });

  it('waits for the tour to end', () => {
    tour.active = true;
    const r = render(<VbCableIntro />);
    expect(dialog()).toBeNull();
    tour.active = false;
    r.rerender(<VbCableIntro />);
    expect(dialog()).toBeInTheDocument();
  });

  it('closes and counts as seen when VB-CABLE turns up with nothing left to show (installed by hand, then Check again)', () => {
    const r = render(<VbCableIntro />);
    expect(dialog()).toBeInTheDocument();
    presence.value = 'present';
    r.rerender(<VbCableIntro />);
    expect(dialog()).toBeNull();
    expect(actions.markIntroSeen).toHaveBeenCalledTimes(1);
  });

  it('stays open when the driver lands during the install', () => {
    const r = render(<VbCableIntro />);
    presence.value = 'present';
    state({ attempt: 'running' });
    r.rerender(<VbCableIntro />);
    expect(dialog()).toBeInTheDocument();
  });

  it('Not now closes it and marks it seen; a ready line it showed is dismissed with it', () => {
    const r = render(<VbCableIntro />);
    fireEvent.click(screen.getByText('not-now'));
    expect(dialog()).toBeNull();
    expect(actions.markIntroSeen).toHaveBeenCalledTimes(1);
    expect(actions.dismissReady).not.toHaveBeenCalled();
    r.unmount();
    const again = render(<VbCableIntro />);
    presence.value = 'present';
    state({ attempt: 'succeeded' });
    again.rerender(<VbCableIntro />);
    fireEvent.click(screen.getByText('not-now'));
    expect(actions.dismissReady).toHaveBeenCalledTimes(1);
  });
});
