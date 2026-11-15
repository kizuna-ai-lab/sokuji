// src/components/Settings/shared/OutletSelect.tsx
//
// An outlet's device · channel select (spec §1.3), shared by the speech
// section and the toolbar's headphones entry.
import { useTranslation } from 'react-i18next';
import { entryValue, outletEntries, outletSelectValue, parseEntryValue } from '../../../lib/audio/outletOptions';
import type { OutletName } from '../../../lib/audio/outlets';
import { useAudioContext, useOutlets, useSetOutletChannel, useSetOutletDevice } from '../../../stores/audioStore';
import { useFilteredDevices } from './hooks';

export function OutletSelect({ name, label, faceToFace }: { name: OutletName; label: string; faceToFace: boolean }) {
  const { t } = useTranslation();
  const { audioMonitorDevices, selectedMonitorDevice } = useAudioContext();
  const devices = useFilteredDevices(audioMonitorDevices);
  const outlets = useOutlets();
  const setOutletDevice = useSetOutletDevice();
  const setOutletChannel = useSetOutletChannel();
  const channelName = (channel: 'left' | 'right') => (channel === 'left' ? t('audioPanel.channelLeft', 'left channel') : t('audioPanel.channelRight', 'right channel'));
  return (
    <select
      className="select-dropdown"
      aria-label={label}
      value={outletSelectValue(name, outlets[name], faceToFace, devices)}
      onChange={(e) => {
        const { device, channel } = parseEntryValue(e.target.value);
        setOutletDevice(name, device);
        setOutletChannel(name, channel);
      }}
    >
      {outletEntries(devices).map((entry) => {
        const base = entry.device === null
          ? (entry.channel === 'auto'
            ? (selectedMonitorDevice ? t('audioPanel.followDefaultNamed', { device: selectedMonitorDevice.label, defaultValue: 'Follow default ({{device}})' }) : t('audioPanel.followDefault', 'Follow default'))
            : t('audioPanel.followDefault', 'Follow default'))
          : entry.label!;
        const text = entry.channel === 'left' || entry.channel === 'right' ? `${base} · ${channelName(entry.channel)}` : base;
        return <option key={entryValue(entry)} value={entryValue(entry)}>{text}</option>;
      })}
    </select>
  );
}
