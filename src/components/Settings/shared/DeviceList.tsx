import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AudioDevice, isVirtualMic, isVirtualSpeaker } from './hooks';

interface DeviceListProps {
  devices: AudioDevice[];
  selectedDevice: AudioDevice | null;
  isDeviceOn: boolean;
  onSelect: (device: AudioDevice) => void;
  onToggleOff: () => void;
  disabled?: boolean;
  /** 'input' for microphone, 'output' for speaker */
  deviceType: 'input' | 'output';
  /** Filter out virtual devices from the list */
  filterVirtual?: boolean;
  /** Show virtual device indicators */
  showVirtualIndicators?: boolean;
  /** Callback when virtual device is clicked */
  onVirtualDeviceClick?: (device: AudioDevice) => void;
  /** Additional class name */
  className?: string;
  /** Accessible label for the Off option (context-specific, e.g. "Turn off microphone") */
  toggleAriaLabel?: string;
  /**
   * Id of an element explaining why the list is disabled. Without it the
   * `aria-disabled` options announce the refusal but never the reason.
   */
  ariaDescribedBy?: string;
}

const DeviceList: React.FC<DeviceListProps> = ({
  devices,
  selectedDevice,
  isDeviceOn,
  onSelect,
  onToggleOff,
  disabled = false,
  deviceType,
  filterVirtual = false,
  showVirtualIndicators = true,
  onVirtualDeviceClick,
  className = '',
  toggleAriaLabel,
  ariaDescribedBy
}) => {
  const { t } = useTranslation();

  const isVirtual = (device: AudioDevice) => {
    return deviceType === 'input' ? isVirtualMic(device) : isVirtualSpeaker(device);
  };

  const filteredDevices = filterVirtual
    ? devices.filter(device => !isVirtual(device))
    : devices;

  const handleDeviceClick = (device: AudioDevice) => {
    if (disabled) return;

    // Check for virtual device
    if (showVirtualIndicators && isVirtual(device) && onVirtualDeviceClick) {
      onVirtualDeviceClick(device);
      return;
    }

    // Turn on if off
    if (!isDeviceOn) {
      onSelect(device);
      return;
    }

    // Select the device
    onSelect(device);
  };

  const handleOffClick = () => {
    if (disabled) return;
    if (isDeviceOn) {
      onToggleOff();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, action: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      action();
    }
  };

  return (
    <div
      className={`device-list ${className}`}
      role="listbox"
      aria-label={deviceType === 'input' ? t('simpleConfig.microphone') : t('simpleConfig.speaker')}
      aria-describedby={ariaDescribedBy}
      // Disabled drops every option to tabIndex -1, which would leave nothing in
      // the widget to focus — a keyboard user would tab straight past it and
      // never hear why it won't respond. Take the tab stop at the listbox
      // instead, so the label and the describedby reason get announced. Enabled,
      // the container stays out of the tab order: the options carry it, as before.
      tabIndex={disabled ? 0 : undefined}
      aria-disabled={disabled || undefined}
    >
      {/* Off option */}
      <div
        className={`device-option ${!isDeviceOn ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
        onClick={handleOffClick}
        onKeyDown={(e) => handleKeyDown(e, handleOffClick)}
        role="option"
        aria-selected={!isDeviceOn}
        aria-disabled={disabled}
        aria-label={toggleAriaLabel}
        tabIndex={disabled ? -1 : 0}
      >
        <span>{t('common.off', 'Off')}</span>
        {!isDeviceOn && <div className="selected-indicator" />}
      </div>

      {/* Device options */}
      {filteredDevices.map((device) => {
        const isSelected = isDeviceOn && selectedDevice?.deviceId === device.deviceId;
        const virtual = showVirtualIndicators && isVirtual(device);

        return (
          <div
            key={device.deviceId}
            className={`device-option ${isSelected ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
            onClick={() => handleDeviceClick(device)}
            onKeyDown={(e) => handleKeyDown(e, () => handleDeviceClick(device))}
            role="option"
            aria-selected={isSelected}
            aria-disabled={disabled}
            tabIndex={disabled ? -1 : 0}
          >
            <span>{device.label || t('audioPanel.unknownDevice')}</span>
            {virtual && (
              <div
                className="virtual-indicator"
                title={deviceType === 'input'
                  ? t('audioPanel.virtualMicrophone')
                  : t('audioPanel.virtualSpeaker')
                }
              >
                <AlertTriangle size={14} />
              </div>
            )}
            {isSelected && <div className="selected-indicator" />}
          </div>
        );
      })}
    </div>
  );
};

export default DeviceList;
