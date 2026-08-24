import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import TitleBar from './TitleBar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));
vi.mock('../../utils/environment', () => ({ isElectron: () => true, isMacOS: () => false }));
vi.mock('../Subtitle/SubtitleEnterButton', () => ({ default: () => <button>subtitle</button> }));
vi.mock('./AccountButton', () => ({ default: () => <button className="account-button" /> }));

const props = {
  showSettings: false, showLogs: false,
  onToggleSettings: vi.fn(), onToggleLogs: vi.fn(),
};

beforeEach(cleanup);

describe('TitleBar', () => {
  it('hides the logs button in basic mode', () => {
    const { container } = render(<TitleBar {...props} showLogsButton={false} />);
    expect(container.querySelector('.logs-button')).toBeNull();
  });

  it('shows the logs button in advanced mode', () => {
    const { container } = render(<TitleBar {...props} showLogsButton={true} />);
    expect(container.querySelector('.logs-button')).toBeTruthy();
  });

  it('places the account slot before the subtitle button', () => {
    const { container } = render(<TitleBar {...props} showLogsButton={true} />);
    const actions = container.querySelector('.title-bar__actions')!;
    expect(actions.firstElementChild!.classList.contains('account-button')).toBe(true);
  });
});
