import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SettingRow from './SettingRow';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, d?: string) => d ?? k }) }));

describe('SettingRow', () => {
  it('draws the label, a help tooltip trigger, the switch named after the label, then the control on its own line', () => {
    const onChange = vi.fn();
    render(<SettingRow label="I hear it too" tooltip="Plays it to me as well" switch={{ checked: true, onChange }}><select aria-label="device"><option>AirPods</option></select></SettingRow>);
    expect(screen.getByText('I hear it too')).toBeInTheDocument();
    expect(document.querySelector('.setting-row__head .tooltip-trigger')).not.toBeNull();
    const sw = screen.getByRole('switch', { name: 'I hear it too' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.setting-row__control select')).not.toBeNull();
  });

  it('a row without a switch or a control is one line', () => {
    render(<SettingRow label="Default playback device" tooltip="…" />);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(document.querySelector('.setting-row__control')).toBeNull();
  });

  it('a sub-row carries the connector class', () => {
    render(<SettingRow label="Passthrough" tooltip="…" sub />);
    expect(document.querySelector('.setting-row')?.classList.contains('setting-row--sub')).toBe(true);
  });

  it('greyed: the reason is the row\'s title, the switch is disabled, the control is inert', () => {
    const onChange = vi.fn();
    render(<SettingRow label="Translation I hear" tooltip="…" greyed="Not in Me mode." switch={{ checked: false, onChange }}><select aria-label="device" /></SettingRow>);
    const row = document.querySelector('.setting-row')!;
    expect(row.classList.contains('setting-row--greyed')).toBe(true);
    expect(row.getAttribute('title')).toBe('Not in Me mode.');
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true');
    // The switch's title sits on its wrapper (ToggleSwitch), not on role="switch".
    expect(screen.getByRole('switch').closest('.toggle-switch-component')?.getAttribute('title')).toBe('Not in Me mode.');
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('device')).toBeDisabled();
  });

  it('describedBy reaches the switch element', () => {
    render(<SettingRow label="X" tooltip="…" switch={{ checked: false, onChange: () => {}, describedBy: 'why' }} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-describedby', 'why');
  });

  it('a greyed row names the greyed reason over the switch\'s own title', () => {
    render(<SettingRow label="X" tooltip="…" greyed="Not in Me mode." switch={{ checked: true, onChange: () => {}, disabled: true, title: 'Fixed for this session' }} />);
    expect(screen.getByRole('switch').closest('.toggle-switch-component')?.getAttribute('title')).toBe('Not in Me mode.');
  });

  it('a switch with its own title (locked by the run) keeps it', () => {
    render(<SettingRow label="X" tooltip="…" switch={{ checked: true, onChange: () => {}, disabled: true, title: 'Fixed for this session' }} />);
    expect(screen.getByRole('switch').closest('.toggle-switch-component')?.getAttribute('title')).toBe('Fixed for this session');
  });
});
