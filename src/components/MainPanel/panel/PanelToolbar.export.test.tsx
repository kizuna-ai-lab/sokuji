// On the desktop export lives in History; the extension keeps the menu on its toolbar.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { Exporter } from '../../../lib/export/exporter';
import PanelToolbar from './PanelToolbar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('../../Display/DisplaySettingsPopover', () => ({ __esModule: true, default: () => null }));
vi.mock('../../CaptionShare/CaptionShareButton', () => ({ __esModule: true, default: () => null }));
vi.mock('../HearingButton', () => ({ HearingButton: () => null }));
const env = vi.hoisted(() => ({ electron: false }));
vi.mock('../../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/environment')>()),
  isElectron: () => env.electron,
}));

const exporter: Exporter = { hasContent: true, hasScopedContent: () => true, text: () => 'TEXT', json: () => '{}' };
const renderToolbar = () => render(<PanelToolbar legs={['speaker', 'participant']} exporter={exporter} hasConversation onClear={vi.fn()} />);

afterEach(() => cleanup());

describe('the export menu on the conversation toolbar', () => {
  it('has no export menu on the desktop', () => {
    env.electron = true;
    renderToolbar();
    expect(screen.queryByRole('button', { name: /export/i })).toBeNull();
  });

  it('keeps the export menu in the extension', () => {
    env.electron = false;
    renderToolbar();
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
  });
});
