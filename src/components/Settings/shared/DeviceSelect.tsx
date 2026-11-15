// src/components/Settings/shared/DeviceSelect.tsx
//
// A device choice as one select (the settings mock's audio page): "Off" first
// when the device can be turned off, then the devices. The rules of the list it
// replaces stay: Sokuji's own virtual microphones are refused with a warning; a
// loopback-style input is taken, with one.
import React from 'react';
import { useTranslation } from 'react-i18next';
import { AudioDevice, isLoopbackInput, isVirtualMic } from './hooks';
import { describeDeviceOnHover } from '../../../utils/audioDevices';

const OFF = '';

export interface DeviceSelectProps {
  /** The select's accessible name. */
  label: string;
  devices: AudioDevice[];
  selectedDevice: AudioDevice | null;
  isDeviceOn: boolean;
  onSelect: (device: AudioDevice) => void;
  /** Absent: the device is always on, and there is no Off. */
  onToggleOff?: () => void;
  /**
   * Locked: the select stays in the tab order so its reason (`ariaDescribedBy`)
   * is announced, and takes no choice.
   */
  disabled?: boolean;
  /** Mark and route Sokuji's virtual microphones and loopback inputs (the microphone; not the other side's sources). */
  showVirtualIndicators?: boolean;
  onVirtualDeviceClick?: (device: AudioDevice) => void;
  ariaDescribedBy?: string;
  className?: string;
}

const DeviceSelect: React.FC<DeviceSelectProps> = ({
  label, devices, selectedDevice, isDeviceOn, onSelect, onToggleOff, disabled = false,
  showVirtualIndicators = true, onVirtualDeviceClick, ariaDescribedBy, className = '',
}) => {
  const { t } = useTranslation();
  const chosen = isDeviceOn ? selectedDevice?.deviceId ?? OFF : OFF;
  const virtual = (d: AudioDevice) => showVirtualIndicators && isVirtualMic(d);

  const onChange = (value: string) => {
    if (disabled) return;
    if (value === OFF) {
      if (isDeviceOn) onToggleOff?.();
      return;
    }
    const device = devices.find((d) => d.deviceId === value);
    if (!device) return;
    if (virtual(device) && onVirtualDeviceClick) {
      onVirtualDeviceClick(device);
      return;
    }
    if (showVirtualIndicators && isLoopbackInput(device) && onVirtualDeviceClick) onVirtualDeviceClick(device);
    onSelect(device);
  };

  return (
    <select
      className={`select-dropdown device-select ${className}`}
      aria-label={label}
      aria-describedby={ariaDescribedBy}
      aria-disabled={disabled || undefined}
      value={chosen}
      onChange={(e) => onChange(e.target.value)}
    >
      {(onToggleOff || chosen === OFF) && <option value={OFF}>{t('common.off', 'Off')}</option>}
      {devices.map((d) => (
        <option key={d.deviceId} value={d.deviceId} title={describeDeviceOnHover(d)}>
          {(d.label || t('audioPanel.unknownDevice')) + (virtual(d) ? ` · ${t('audioPanel.virtualMicrophone', 'Virtual microphone')}` : '')}
        </option>
      ))}
    </select>
  );
};

export default DeviceSelect;
