import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

import useAudioStore from '../../stores/audioStore';
import useLogStore from '../../stores/logStore';
import { settleReports } from '../diagnostics/report';
import { createFormFactorLog } from './formFactorLog';

const state = () => useAudioStore.getState();

describe('createFormFactorLog', () => {
  let lines: string[];
  let current: boolean;
  let log: ReturnType<typeof createFormFactorLog>;

  beforeEach(() => {
    lines = [];
    current = true;
    log = createFormFactorLog((l) => lines.push(l), () => current);
    useAudioStore.setState({
      defaultOutputForm: { formFactor: 'speakers', transport: 'builtin' },
      selectedMonitorDevice: null,
      audioMonitorDevices: [
        { deviceId: 'hp', label: 'Headset', isVirtual: false, formFactor: 'headphones', transport: 'usb' },
      ],
      outlets: {
        other: { device: null, channel: 'auto' },
        me: { device: 'hp', channel: 'auto' },
        them: { device: null, channel: 'auto' },
      },
    });
  });

  it('baseline logs every outlet once', () => {
    log.baseline(state());
    expect(lines).toEqual([
      'Output form factor: other → "(system default)" speakers/builtin',
      'Output form factor: me → "Headset" headphones/usb',
      'Output form factor: them → "(system default)" speakers/builtin',
    ]);
  });

  it('an outlet with no device logs (system default) with the default form', () => {
    log.baseline(state());
    expect(lines[0]).toBe('Output form factor: other → "(system default)" speakers/builtin');
  });

  it('update logs only an outlet whose triple changed', () => {
    log.baseline(state());
    lines.length = 0;
    useAudioStore.setState({
      audioMonitorDevices: [{ deviceId: 'hp', label: 'Headset', isVirtual: false, formFactor: 'speakers', transport: 'usb' }],
    });
    log.update(state());
    expect(lines).toEqual(['Output form factor: me → "Headset" speakers/usb']);
  });

  it('a re-read that changes nothing logs nothing', () => {
    log.baseline(state());
    lines.length = 0;
    useAudioStore.setState({ audioMonitorDevices: state().audioMonitorDevices.map((d) => ({ ...d })) });
    log.update(state());
    expect(lines).toEqual([]);
  });

  it('an update while the answer is stale logs nothing', () => {
    log.baseline(state());
    lines.length = 0;
    current = false;
    useAudioStore.setState({ defaultOutputForm: { formFactor: 'unknown', transport: 'unknown' } });
    log.update(state());
    expect(lines).toEqual([]);
  });

  it('the next current update compares with what was last logged, not with the stale state', () => {
    log.baseline(state());
    lines.length = 0;
    current = false;
    useAudioStore.setState({ defaultOutputForm: { formFactor: 'unknown', transport: 'unknown' } });
    log.update(state());
    useAudioStore.setState({ defaultOutputForm: { formFactor: 'speakers', transport: 'builtin' } });
    current = true;
    log.update(state());
    expect(lines).toEqual([]);

    current = false;
    log.update(state());
    useAudioStore.setState({ defaultOutputForm: { formFactor: 'headphones', transport: 'bluetooth' } });
    current = true;
    log.update(state());
    expect(lines).toEqual([
      'Output form factor: other → "(system default)" headphones/bluetooth',
      'Output form factor: them → "(system default)" headphones/bluetooth',
    ]);
  });

  it('nothing reaches the log store while diagnostic logs are off', () => {
    const real = createFormFactorLog((l) => useLogStore.getState().addLog(l, 'info'), () => true);
    useLogStore.getState().clearLogs();
    useLogStore.setState({ enabled: false });
    real.baseline(state());
    expect(useLogStore.getState().allLogs).toEqual([]);

    // The same wiring does write once they are on, so the empty list above is the switch's doing.
    useLogStore.setState({ enabled: true });
    real.baseline(state());
    expect(useLogStore.getState().allLogs).toHaveLength(3);
    useLogStore.setState({ enabled: false });
    useLogStore.getState().clearLogs();
  });

  it('a throwing outlet resolution becomes one warning and does not throw', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    useLogStore.setState({ enabled: true });
    useLogStore.getState().clearLogs();
    const broken = { ...state(), outlets: undefined } as unknown as ReturnType<typeof state>;
    expect(() => log.baseline(broken)).not.toThrow();
    expect(() => log.update(broken)).not.toThrow();
    expect(() => log.update(broken)).not.toThrow();
    await settleReports();
    const warnings = useLogStore.getState().allLogs.filter((l) => l.type === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('[OutputForm]');
    expect(lines).toEqual([]);
    useLogStore.setState({ enabled: false });
    useLogStore.getState().clearLogs();
    vi.restoreAllMocks();
  });
});
