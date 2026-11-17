// Audio's speech output section, seen in two interface languages: the line under "Translation the
// other side hears" tells the user to choose the virtual microphone in their meeting app. The real i18n catalogs.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

vi.mock('../../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
vi.mock('../../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: async () => ({ success: true }) }) },
}));
vi.mock('../../../app/useRun', () => ({ useRunParticipantSpeech: () => null }));
vi.mock('../../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/environment')>()),
  getEnvironment: () => 'electron', isElectron: () => true, isExtension: () => false,
  isMacOS: () => true, isWindows: () => false, isLinux: () => false,
}));
vi.mock('../../../lib/audio/appAudio', () => ({ getAppAudio: async () => ({ earPreview: async () => {} }) }));
vi.mock('../../VbCable/VbCableNotice', () => ({ default: () => null }));

import { changeLanguageWithLoad } from '../../../locales';
import useAudioStore from '../../../stores/audioStore';
import { useProviderStore } from '../../../stores/providerStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { SONIOX_DEFAULTS } from '../../../providers/soniox/settings';
import SpeechOutputSection from './SpeechOutputSection';
import ja from '../../../locales/ja/translation.json';
import zhCN from '../../../locales/zh_CN/translation.json';
import en from '../../../locales/en/translation.json';

beforeEach(() => {
  useProviderStore.setState({
    selected: 'soniox',
    entries: { soniox: { settings: SONIOX_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' } } },
  } as never);
  useAudioStore.setState({ mode: 'speaker', otherSide: 'meeting', audioMonitorDevices: [], selectedMonitorDevice: null } as never);
  useSettingsStore.setState({ textOnly: false });
});
afterEach(async () => { cleanup(); await changeLanguageWithLoad('en'); });

/** The line under the row whose field names the virtual microphone. */
const otherHearsLine = () => {
  const row = document.getElementById('speech-other-hears-section') as HTMLElement;
  return row.querySelector('.setting-row__desc')?.textContent ?? '';
};

describe('the virtual microphone line in the speech output section', () => {
  for (const [code, catalog] of [['ja', ja], ['zh_CN', zhCN]] as const) {
    it(`in ${code}: the row says, in that language, to choose the virtual microphone in the meeting app`, async () => {
      await act(async () => { await changeLanguageWithLoad(code); });
      render(<SpeechOutputSection isSessionActive={false} />);
      expect(otherHearsLine()).toBe(catalog.audioPanel.otherHearsTip);
      expect(otherHearsLine()).not.toBe(en.audioPanel.otherHearsTip);
      // The field beside it names the device to pick there.
      expect(document.getElementById('speech-other-hears-section')).toHaveTextContent('SokujiVirtualAudio');
    });
  }
});
