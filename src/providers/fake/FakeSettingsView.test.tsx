import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FakeSettingsView } from './FakeSettingsView';
import { FAKE_DEFAULTS } from './settings';

describe('FakeSettingsView', () => {
  it('chooses a script', () => {
    const update = vi.fn();
    render(<FakeSettingsView settings={FAKE_DEFAULTS} update={update} />);
    fireEvent.change(screen.getByLabelText('Script'), { target: { value: 'long' } });
    expect(update).toHaveBeenCalledWith({ script: 'long' });
  });

  it('flips each fault switch', () => {
    const update = vi.fn();
    render(<FakeSettingsView settings={{ ...FAKE_DEFAULTS, checkFails: true }} update={update} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Require an API key' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Check reports not ready' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Refuse to build' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Fail to start' }));
    expect(update.mock.calls).toEqual([
      [{ requireKey: true }], [{ checkFails: false }], [{ buildRefused: true }], [{ startThrows: true }],
    ]);
  });

  it('reads a delay as whole, non-negative milliseconds', () => {
    const update = vi.fn();
    render(<FakeSettingsView settings={FAKE_DEFAULTS} update={update} />);
    fireEvent.change(screen.getByLabelText('Start delay (ms)'), { target: { value: '-5' } });
    fireEvent.change(screen.getByLabelText('Fail after (ms, 0 = never)'), { target: { value: '1500.4' } });
    expect(update.mock.calls).toEqual([[{ startDelayMs: 0 }], [{ failAfterMs: 1500 }]]);
  });
});
