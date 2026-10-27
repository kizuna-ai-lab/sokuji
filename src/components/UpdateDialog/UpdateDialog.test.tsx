import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import useUpdateStore from '../../stores/updateStore';

// t(key) renders the key itself: these pin which keys the dialog uses.
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isElectron: () => false,
}));

import UpdateDialog from './UpdateDialog';

const open = (extra: Record<string, unknown>) =>
  useUpdateStore.setState({
    dialogOpen: true, status: 'downloading', newVersion: '0.46.5', changelog: null,
    downloadProgress: 0, downloadTransferred: 0, downloadTotal: 0, downloadIndeterminate: false,
    supportsAutoUpdate: true, errorMessage: null, errorFrom: null,
    ...extra,
  } as any);

afterEach(cleanup);

describe('UpdateDialog while downloading', () => {
  beforeEach(() => { open({}); });

  it('shows an indeterminate bar and no percentage when the updater reports no byte counts (Squirrel on Windows)', () => {
    open({ downloadIndeterminate: true });
    const { container } = render(<UpdateDialog />);
    expect(screen.getAllByText('update.downloadingIndeterminate').length).toBeGreaterThan(0);
    expect(container.querySelector('.progress-fill--indeterminate')).not.toBeNull();
    expect(screen.queryByText(/\d+%$/)).toBeNull();
  });

  it('shows the percentage and the bytes for a byte-counted download', () => {
    open({ downloadProgress: 42, downloadTransferred: 42, downloadTotal: 100 });
    const { container } = render(<UpdateDialog />);
    expect(screen.getAllByText('update.downloading').length).toBeGreaterThan(0);
    expect(screen.getByText('42%')).toBeTruthy();
    expect((container.querySelector('.progress-fill') as HTMLElement).style.width).toBe('42%');
    expect(container.querySelector('.progress-fill--indeterminate')).toBeNull();
  });
});
