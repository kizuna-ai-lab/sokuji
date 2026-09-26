import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FakeLeasedSettingsView } from './FakeLeasedSettingsView';
import { FAKE_LEASED_DEFAULTS } from './settings';

describe('FakeLeasedSettingsView', () => {
  it("draws the fake's own controls and the three hook knobs", () => {
    const update = vi.fn();
    render(<FakeLeasedSettingsView settings={FAKE_LEASED_DEFAULTS} update={update} />);
    expect(screen.getByLabelText('Script')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Prepare answers with a fallback' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Share one session in Both' }));
    fireEvent.change(screen.getByLabelText('Lease ends after (ms, 0 = never)'), { target: { value: '3000' } });
    expect(update.mock.calls).toEqual([[{ prepareFallback: true }], [{ sharedBoth: false }], [{ leaseEndsAfterMs: 3000 }]]);
  });
});
