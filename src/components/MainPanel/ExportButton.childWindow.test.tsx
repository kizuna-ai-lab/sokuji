import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import type { Exporter } from '../../lib/export/exporter';
import { ExportMenuButton } from './ExportButton';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, def?: string) => (typeof def === 'string' ? def : key) }),
}));
// The real host opens an OS child window; render its children inline instead.
vi.mock('../Subtitle/ChildWindowPopover', () => ({
  ChildWindowPopover: ({ open, children }: { open: boolean; children: ReactNode }) =>
    (open ? <div>{children}</div> : null),
  useChildPopoverToggle: () => ({ open: true, toggle: vi.fn(), onClose: vi.fn() }),
}));

const fakeExporter: Exporter = {
  hasContent: true,
  hasScopedContent: () => true,
  text: () => 'TEXT',
  json: () => '{}',
};

describe('ExportMenuButton in the subtitle bar child window', () => {
  it('carries the actions without the roving ring, and no auto-save row', () => {
    render(
      <ExportMenuButton
        exporter={fakeExporter}
        speakerMode="both"
        participantMode="both"
        popoverHost="child-window"
      />,
    );
    expect(screen.getByRole('menuitem', { name: 'Download as .txt' })).not.toHaveAttribute('tabindex');
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Export TXT when a session ends' })).not.toBeInTheDocument();
  });
});
