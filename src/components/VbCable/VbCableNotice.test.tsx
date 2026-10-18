// src/components/VbCable/VbCableNotice.test.tsx
/**
 * Which state VbCableNotice draws (spec 2026-10-17 §4), asserted by key:
 * the copy itself is localised and invisible to a test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { VbCablePresence } from '../../lib/audio/vbCable';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
  Trans: ({ i18nKey }: { i18nKey: string }) => <>{i18nKey}</>,
}));
const presence = vi.hoisted(() => ({ value: 'missing' as VbCablePresence }));
vi.mock('../../stores/vbCableStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../stores/vbCableStore')>()),
  useVbCablePresence: () => presence.value,
}));
const openExternalUrl = vi.hoisted(() => vi.fn());
vi.mock('../../utils/openExternalUrl', () => ({ openExternalUrl }));

import { useVbCableStore, type VbCableState } from '../../stores/vbCableStore';
import VbCableNotice from './VbCableNotice';

const actions = { load: vi.fn(async () => {}), install: vi.fn(async () => {}), checkAgain: vi.fn(async () => {}), dismissReady: vi.fn(), markIntroSeen: vi.fn() };
const state = (s: Partial<VbCableState>) => useVbCableStore.setState({ channel: 'website', introSeen: false, attempt: 'none', readyDismissed: false, ...actions, ...s });

beforeEach(() => {
  presence.value = 'missing';
  Object.values(actions).forEach((a) => a.mockClear());
  openExternalUrl.mockClear();
  state({});
});

describe('VbCableNotice', () => {
  it('draws nothing where VB-CABLE does not apply, or before the list or the channel is known', () => {
    for (const p of ['not-applicable', 'unknown'] as const) {
      presence.value = p;
      const { container, unmount } = render(<VbCableNotice variant="row" />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
    presence.value = 'missing';
    state({ channel: null });
    expect(render(<VbCableNotice variant="row" />).container).toBeEmptyDOMElement();
  });

  it('website, missing: offers the install, a link about it, and says Windows asks once', () => {
    render(<VbCableNotice variant="row" />);
    expect(screen.getByText('vbCable.title')).toBeInTheDocument();
    expect(screen.getByText('vbCable.adminOnce')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'vbCable.install' }));
    expect(actions.install).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /vbCable\.about/ }));
    expect(openExternalUrl).toHaveBeenCalledWith('https://vb-audio.com/Cable/');
  });

  it('website, running: says what to approve, with a busy button', () => {
    state({ attempt: 'running' });
    render(<VbCableNotice variant="row" />);
    expect(screen.getByText('vbCable.installingTitle')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /vbCable\.installingBusy/ })).toBeDisabled();
  });

  it('website, main says done but the list has not caught up: Check again instead of a busy button', () => {
    state({ attempt: 'succeeded' });
    render(<VbCableNotice variant="row" />);
    expect(screen.getByText('vbCable.installingTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'vbCable.checkAgain' }));
    expect(actions.checkAgain).toHaveBeenCalledTimes(1);
  });

  it('website, failed: try again, or install it yourself', () => {
    state({ attempt: 'failed' });
    render(<VbCableNotice variant="row" />);
    expect(screen.getByText('vbCable.failedTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'vbCable.retry' }));
    expect(actions.install).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /vbCable\.installYourself/ }));
    expect(openExternalUrl).toHaveBeenCalledWith('https://vb-audio.com/Cable/');
  });

  it('Store build: steps and a link, never an install button', () => {
    state({ channel: 'store' });
    render(<VbCableNotice variant="row" />);
    expect(screen.getByText('vbCable.storeStep2')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'vbCable.install' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /vbCable\.openWebsite/ }));
    expect(openExternalUrl).toHaveBeenCalledWith('https://vb-audio.com/Cable/');
    fireEvent.click(screen.getByRole('button', { name: 'vbCable.checkAgain' }));
    expect(actions.checkAgain).toHaveBeenCalledTimes(1);
  });

  it('present with no install this session: nothing', () => {
    presence.value = 'present';
    expect(render(<VbCableNotice variant="row" />).container).toBeEmptyDOMElement();
  });

  it('present while the install is still running: ready, not installing', () => {
    presence.value = 'present';
    state({ attempt: 'running' });
    render(<VbCableNotice variant="row" />);
    expect(screen.getByText('vbCable.readyTitle')).toBeInTheDocument();
    expect(screen.queryByText('vbCable.installingTitle')).toBeNull();
  });

  it('ready: a × that dismisses it, and nothing once dismissed', () => {
    presence.value = 'present';
    state({ attempt: 'succeeded' });
    const { unmount } = render(<VbCableNotice variant="row" />);
    fireEvent.click(screen.getByRole('button', { name: 'common.dismiss' }));
    expect(actions.dismissReady).toHaveBeenCalledTimes(1);
    unmount();
    state({ attempt: 'succeeded', readyDismissed: true });
    expect(render(<VbCableNotice variant="row" />).container).toBeEmptyDOMElement();
  });

  it('modal: the dialog carries the prompt title; Not now; no × on ready', () => {
    const onNotNow = vi.fn();
    const { unmount } = render(<VbCableNotice variant="modal" onNotNow={onNotNow} />);
    expect(screen.queryByText('vbCable.title')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'vbCable.notNow' }));
    expect(onNotNow).toHaveBeenCalledTimes(1);
    unmount();
    presence.value = 'present';
    state({ attempt: 'succeeded' });
    render(<VbCableNotice variant="modal" onNotNow={onNotNow} />);
    expect(screen.getByText('vbCable.readyTitle')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'common.dismiss' })).toBeNull();
  });

  it('loads the store when it mounts', () => {
    render(<VbCableNotice variant="row" />);
    expect(actions.load).toHaveBeenCalled();
  });
});
