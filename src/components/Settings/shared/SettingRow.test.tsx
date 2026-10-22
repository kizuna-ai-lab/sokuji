import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { resolve } from 'node:path';
import { compile } from 'sass';
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

  it('draws a badge right after the label when given one, and none otherwise', () => {
    const { rerender } = render(<SettingRow label="Screen context" tooltip="t" badge="Beta" />);
    const badge = document.querySelector('.setting-row__head .setting-row__badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe('Beta');
    expect(badge!.previousElementSibling).toHaveClass('setting-row__label');
    rerender(<SettingRow label="Screen context" tooltip="t" />);
    expect(document.querySelector('.setting-row__badge')).toBeNull();
  });

  it('draws an accessory in the head after the help and before the switch, and nothing for it when none is given', () => {
    const parts = ['setting-row__label', 'setting-row__badge', 'tooltip-trigger', 'setting-row__accessory', 'toggle-switch-component'];
    const head = () => Array.from(document.querySelector('.setting-row__head')!.children, (el) => parts.find((c) => el.classList.contains(c)) ?? el.getAttribute('class'));
    const { rerender } = render(<SettingRow label="Screen context" tooltip="t" badge="Beta" switch={{ checked: true, onChange: vi.fn() }} accessory={<button type="button">Slides</button>} />);
    expect(head()).toEqual(['setting-row__label', 'setting-row__badge', 'tooltip-trigger', 'setting-row__accessory', 'toggle-switch-component']);
    expect(document.querySelector('.setting-row__accessory > button')?.textContent).toBe('Slides');
    // Without one the head is exactly what it was.
    rerender(<SettingRow label="Screen context" tooltip="t" badge="Beta" switch={{ checked: true, onChange: vi.fn() }} />);
    expect(head()).toEqual(['setting-row__label', 'setting-row__badge', 'tooltip-trigger', 'toggle-switch-component']);
    // A falsy accessory (`on && <…/>`) draws no wrapper either.
    rerender(<SettingRow label="Screen context" tooltip="t" switch={{ checked: false, onChange: vi.fn() }} accessory={false} />);
    expect(document.querySelector('.setting-row__accessory')).toBeNull();
    // A greyed row takes no input: like the footer, the accessory is not drawn.
    rerender(<SettingRow label="Screen context" tooltip="t" greyed="Not now." switch={{ checked: true, onChange: vi.fn() }} accessory={<button type="button">Slides</button>} />);
    expect(document.querySelector('.setting-row__accessory')).toBeNull();
  });

  it('the accessory takes the room the head has left (zero basis, grows), its content at the right, the switch right after it (compiled Settings.scss)', () => {
    const { css } = compile(resolve(__dirname, '../Settings.scss'));
    const rule = (selector: string) => new RegExp(String.raw`(^|\n)${selector.replace(/[.+()]/g, '\\$&')}\s*\{([^}]*)\}`).exec(css)?.[2] ?? '';
    const accessory = rule('.setting-row__accessory');
    expect(accessory).toMatch(/flex:\s*1 1 0\b/);
    expect(accessory).toMatch(/justify-content:\s*flex-end/);
    // No min-width: 0 — it is never narrower than its content's own minimum, so a button in it is never cut.
    expect(accessory).not.toMatch(/min-width/);
    expect(rule('.setting-row__switch')).toMatch(/margin-left:\s*auto/);
    expect(rule('.setting-row__accessory + .setting-row__switch')).toMatch(/margin-left:\s*0/);
    // Beside an accessory a label wraps only where its words allow (CJK too: at a space or a zero-width space),
    // and breaks inside a word as the last resort, so the head never overflows; the help icon keeps its size.
    const label = rule('.setting-row__head:has(> .setting-row__accessory) .setting-row__label');
    expect(label).toMatch(/overflow-wrap:\s*anywhere/);
    expect(label).toMatch(/word-break:\s*keep-all/);
    expect(rule('.setting-row__head:has(> .setting-row__accessory) > .tooltip-trigger')).toMatch(/flex:\s*none/);
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

  it('greyed: the switch shows off even when its stored value is on', () => {
    render(<SettingRow label="Keep for replay" tooltip="…" greyed="Nothing is spoken." switch={{ checked: true, onChange: vi.fn() }} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
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
