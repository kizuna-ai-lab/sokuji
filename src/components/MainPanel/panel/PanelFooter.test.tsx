import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PanelFooter, type PanelFooterProps } from './PanelFooter';
import type { RunState } from '../../../lib/session/types';

// react-i18next: return the key itself, so every assertion below is against
// the real key the component asks for, whether or not the markup happens to
// pass a default value too.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

afterEach(() => {
  cleanup();
});

const SITES = ['basic', 'advanced'] as const;

const idleRun: RunState = { phase: 'idle' };

const baseProps = (site: 'basic' | 'advanced', over: Partial<PanelFooterProps> = {}): PanelFooterProps => ({
  site,
  run: idleRun,
  mode: 'speaker',
  missingDevice: null,
  canStart: true,
  holdToTalk: false,
  held: false,
  micMuted: false,
  pair: null,
  duration: null,
  onStart: vi.fn(),
  onStop: vi.fn(),
  onPress: vi.fn(),
  onRelease: vi.fn(),
  onModeSegment: vi.fn(),
  onLanguages: vi.fn(),
  ...over,
});

const actionButton = (container: HTMLElement) =>
  container.querySelector('[data-tour="main-action"]') as HTMLButtonElement;

describe('PanelFooter — tour anchor', () => {
  it.each(SITES)('%s: exactly one [data-tour="main-action"]', (site) => {
    const { container } = render(<PanelFooter {...baseProps(site)} />);
    expect(container.querySelectorAll('[data-tour="main-action"]').length).toBe(1);
  });
});

describe('PanelFooter — idle / start gate', () => {
  it.each(SITES)('%s: idle shows Start and calls onStart', (site) => {
    const onStart = vi.fn();
    const { container } = render(<PanelFooter {...baseProps(site, { onStart })} />);
    const btn = actionButton(container);
    const label = site === 'basic' ? 'simplePanel.start' : 'mainPanel.startSession';
    expect(btn.textContent).toContain(label);
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it.each(SITES)('%s: canStart false with a startBlockMessage disables Start and shows the message', (site) => {
    const message = 'Configure devices for this mode to start.';
    const { container } = render(
      <PanelFooter {...baseProps(site, { canStart: false, startBlockMessage: message })} />,
    );
    const btn = actionButton(container);
    expect(btn).toBeDisabled();
    if (site === 'basic') {
      expect(btn.getAttribute('title')).toBe(message);
    } else {
      expect(btn.querySelector('.tooltip')?.textContent).toBe(message);
    }
  });
});

describe('PanelFooter — starting', () => {
  it.each(SITES)('%s: loading 1/3 shows a spinner and the progress label, stays enabled, cancels via onStop', (site) => {
    const onStop = vi.fn();
    const run: RunState = {
      phase: 'starting',
      step: 'opening',
      loading: { leg: 'speaker', stage: 'asr', done: 1, total: 3 },
    };
    const { container } = render(<PanelFooter {...baseProps(site, { run, onStop })} />);
    const btn = actionButton(container);
    const spinnerClass = site === 'basic' ? '.spinning' : '.spinner';
    expect(btn.querySelector(spinnerClass)).toBeTruthy();
    const label = site === 'basic' ? 'simplePanel.initProgress' : 'mainPanel.initProgress';
    expect(btn.textContent).toContain(label);
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(btn.getAttribute('title')).toBe('mainPanel.clickToCancel');
  });
});

describe('PanelFooter — running / stopping', () => {
  it.each(SITES)('%s: running shows the Stop variant, calls onStop, active dot, duration', (site) => {
    const onStop = vi.fn();
    const run: RunState = { phase: 'running', since: 0, legs: {} };
    const { container } = render(<PanelFooter {...baseProps(site, { run, onStop, duration: '00:05' })} />);
    const btn = actionButton(container);
    if (site === 'basic') {
      expect(btn.className).toContain('main-action-btn stop');
      expect(btn.textContent).toContain('simplePanel.stop');
    } else {
      expect(btn.className).toContain('session-button active');
      expect(btn.textContent).toContain('mainPanel.endSession');
    }
    fireEvent.click(btn);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.status-dot.active')).toBeTruthy();
    expect(container.querySelector('.session-duration')?.textContent).toBe('00:05');
  });

  it.each(SITES)('%s: stopping shows the same Stop variant, disabled, no active dot, no duration', (site) => {
    const run: RunState = { phase: 'stopping' };
    const { container } = render(<PanelFooter {...baseProps(site, { run, duration: '00:05' })} />);
    const btn = actionButton(container);
    if (site === 'basic') {
      expect(btn.className).toContain('main-action-btn stop');
    } else {
      expect(btn.className).toContain('session-button active');
    }
    expect(btn).toBeDisabled();
    expect(container.querySelector('.status-dot.active')).toBeNull();
    expect(container.querySelector('.session-duration')).toBeNull();
  });
});

describe('PanelFooter — reconnecting', () => {
  it.each(SITES)('%s: a reconnecting leg paints the status dot; basic alone shows the label', (site) => {
    const run: RunState = { phase: 'running', since: 0, legs: { speaker: 'reconnecting' } };
    const { container } = render(<PanelFooter {...baseProps(site, { run })} />);
    expect(container.querySelector('.status-dot.reconnecting')).toBeTruthy();
    const label = screen.queryByText('connectionStatus.reconnecting');
    if (site === 'basic') {
      expect(label).toBeInTheDocument();
    } else {
      expect(label).toBeNull();
    }
  });
});

describe('PanelFooter — hold to talk', () => {
  it.each(SITES)('%s: holdToTalk shows the hold button, press/release call onPress/onRelease, held shows Release', (site) => {
    const onPress = vi.fn();
    const onRelease = vi.fn();
    const holdClass = site === 'basic' ? 'push-to-talk-btn' : 'push-to-talk-button';
    const { container, rerender } = render(
      <PanelFooter {...baseProps(site, { holdToTalk: true, onPress, onRelease })} />,
    );
    const btn = container.querySelector(`.${holdClass}`) as HTMLButtonElement;
    expect(btn).toBeTruthy();
    fireEvent.mouseDown(btn);
    expect(onPress).toHaveBeenCalledTimes(1);
    fireEvent.mouseUp(btn);
    expect(onRelease).toHaveBeenCalledTimes(1);

    rerender(<PanelFooter {...baseProps(site, { holdToTalk: true, held: true, onPress, onRelease })} />);
    const heldLabel = site === 'basic' ? 'simplePanel.release' : 'mainPanel.release';
    expect(container.querySelector(`.${holdClass}`)?.textContent).toContain(heldLabel);
  });

  it('advanced: micMuted disables the hold button and shows inputDeviceOff', () => {
    const { container } = render(
      <PanelFooter {...baseProps('advanced', { holdToTalk: true, micMuted: true })} />,
    );
    const btn = container.querySelector('.push-to-talk-button') as HTMLButtonElement;
    expect(btn).toBeDisabled();
    expect(btn.textContent).toContain('mainPanel.inputDeviceOff');
  });
});

describe('PanelFooter — mode picker', () => {
  it.each(SITES)('%s: missingDevice warns the speaker segment', (site) => {
    render(<PanelFooter {...baseProps(site, { missingDevice: 'speaker' })} />);
    const speakerSegment = screen.getByRole('button', { name: 'modePicker.modeYou' });
    expect(speakerSegment.className).toContain('mode-picker__segment--warn');
  });

  it.each(SITES)('%s: a run that is not idle locks the picker', (site) => {
    const run: RunState = { phase: 'starting', step: 'checking' };
    const { container } = render(<PanelFooter {...baseProps(site, { run })} />);
    expect(container.querySelector('.mode-picker')?.className).toContain('mode-picker--locked');
  });
});

describe('PanelFooter — language pair', () => {
  it.each(SITES)('%s: reads "ja → en" and calls onLanguages', (site) => {
    const onLanguages = vi.fn();
    const { container } = render(
      <PanelFooter {...baseProps(site, { pair: { source: 'ja', target: 'en' }, onLanguages })} />,
    );
    const el = container.querySelector('.language-pair') as HTMLElement;
    expect(el.textContent).toBe('ja → en');
    fireEvent.click(el);
    expect(onLanguages).toHaveBeenCalledTimes(1);
  });
});

describe('PanelFooter — test tone', () => {
  it('advanced: testTone toggles and shows stopDebug while playing', () => {
    const toggle = vi.fn();
    const { container } = render(
      <PanelFooter {...baseProps('advanced', { testTone: { playing: true, toggle } })} />,
    );
    const btn = container.querySelector('.debug-button') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('mainPanel.stopDebug');
    fireEvent.click(btn);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('basic never shows the debug button, even with testTone set', () => {
    const { container } = render(
      <PanelFooter {...baseProps('basic', { testTone: { playing: true, toggle: vi.fn() } })} />,
    );
    expect(container.querySelector('.debug-button')).toBeNull();
  });
});

describe('PanelFooter — waveforms', () => {
  it('advanced renders waveforms.input and .output; basic renders neither', () => {
    const waveforms = {
      input: <div data-testid="wf-input" />,
      output: <div data-testid="wf-output" />,
    };
    const { container } = render(<PanelFooter {...baseProps('advanced', { waveforms })} />);
    expect(container.querySelector('[data-testid="wf-input"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="wf-output"]')).toBeTruthy();

    cleanup();
    const { container: basicContainer } = render(<PanelFooter {...baseProps('basic', { waveforms })} />);
    expect(basicContainer.querySelector('[data-testid="wf-input"]')).toBeNull();
    expect(basicContainer.querySelector('[data-testid="wf-output"]')).toBeNull();
  });
});
