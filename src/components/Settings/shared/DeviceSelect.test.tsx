// The device choice as the settings mock draws it: one select, "Off" first,
// with the device list's rules kept — Sokuji's own virtual microphones are
// refused with a warning, a loopback-style input is taken with one.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import DeviceSelect from './DeviceSelect';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, def?: string) => def ?? key }),
}));

const devices = [
  { deviceId: 'mic-1', label: 'Built-in Microphone' },
  { deviceId: 'loop-1', label: 'Stereo Mix (Realtek High Definition Audio)' },
  { deviceId: 'virt-1', label: 'Sokuji_Virtual_Mic' },
];

const setup = (over: Partial<React.ComponentProps<typeof DeviceSelect>> = {}) => {
  const props = {
    label: 'Microphone',
    devices,
    selectedDevice: devices[0],
    isDeviceOn: true,
    onSelect: vi.fn(),
    onToggleOff: vi.fn(),
    onVirtualDeviceClick: vi.fn(),
    ...over,
  };
  render(<DeviceSelect {...props} />);
  return { props, select: screen.getByRole('combobox', { name: 'Microphone' }) as HTMLSelectElement };
};

afterEach(() => cleanup());

describe('DeviceSelect', () => {
  it('lists Off first, then every device, and shows the one in use', () => {
    const { select } = setup();
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'Off', 'Built-in Microphone', 'Stereo Mix (Realtek High Definition Audio)', 'Sokuji_Virtual_Mic · Virtual microphone',
    ]);
    expect(select.value).toBe('mic-1');
  });

  it('shows Off while the device is off', () => {
    const { select } = setup({ isDeviceOn: false });
    expect(select.selectedOptions[0].textContent).toBe('Off');
  });

  it('turns the device off, and picks a device', () => {
    const { props, select } = setup();
    fireEvent.change(select, { target: { value: '' } });
    expect(props.onToggleOff).toHaveBeenCalled();
    fireEvent.change(select, { target: { value: 'mic-1' } });
    expect(props.onSelect).toHaveBeenCalledWith(devices[0]);
  });

  it('refuses a virtual microphone with its warning, and takes a loopback input with one', () => {
    const { props, select } = setup();
    fireEvent.change(select, { target: { value: 'virt-1' } });
    expect(props.onVirtualDeviceClick).toHaveBeenCalledWith(devices[2]);
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(select.value).toBe('mic-1');
    fireEvent.change(select, { target: { value: 'loop-1' } });
    expect(props.onVirtualDeviceClick).toHaveBeenCalledWith(devices[1]);
    expect(props.onSelect).toHaveBeenCalledWith(devices[1]);
  });

  it('has no Off without a way to turn the device off', () => {
    const { select } = setup({ onToggleOff: undefined });
    expect([...select.options].map((o) => o.textContent)).not.toContain('Off');
  });

  it('stays reachable while locked, says why, and takes no choice', () => {
    const reason = document.createElement('p');
    reason.id = 'why';
    reason.textContent = 'Not in this mode.';
    document.body.appendChild(reason);
    const { props, select } = setup({ disabled: true, ariaDescribedBy: 'why' });
    expect(select).not.toBeDisabled();
    expect(select).toHaveAttribute('aria-disabled', 'true');
    expect(select).toHaveAttribute('aria-describedby', 'why');
    fireEvent.change(select, { target: { value: '' } });
    expect(props.onToggleOff).not.toHaveBeenCalled();
    reason.remove();
  });
});
