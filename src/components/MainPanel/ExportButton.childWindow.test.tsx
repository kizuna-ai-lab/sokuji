import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ExportButton from './ExportButton';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, def?: string) => (typeof def === 'string' ? def : key) }),
}));
vi.mock('../Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
const setAutoSaveOnStop = vi.fn(async () => {});
vi.mock('../../stores/settingsStore', () => ({
  useAutoSaveOnStop: () => false,
  useSetAutoSaveOnStop: () => setAutoSaveOnStop,
}));
// The real host opens an OS child window; render its children inline instead.
vi.mock('../Subtitle/ChildWindowPopover', () => ({
  ChildWindowPopover: ({ open, children }: { open: boolean; children: ReactNode }) =>
    (open ? <div>{children}</div> : null),
  useChildPopoverToggle: () => ({ open: true, toggle: vi.fn(), onClose: vi.fn() }),
}));

describe('ExportButton in the subtitle bar child window', () => {
  it('carries the auto-save row, without the roving ring', () => {
    render(
      <ExportButton
        combinedItems={[]}
        provider="openai"
        currentProviderSettings={{}}
        localInferenceSettings={{}}
        sourceLanguage="EN"
        targetLanguage="JA"
        speakerMode="both"
        participantMode="both"
        popoverHost="child-window"
      />,
    );
    const row = screen.getByRole('menuitemcheckbox', { name: 'Auto-save when session ends' });
    expect(row).not.toHaveAttribute('tabindex');

    fireEvent.click(row);
    expect(setAutoSaveOnStop).toHaveBeenCalledWith(true);
  });
});
