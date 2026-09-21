/**
 * SegmentationDownloadModal — the one confirmation the punctuation pack ever
 * asks for. It lists the three models, their sizes and the total the user is
 * about to spend, and nothing downloads until the confirm button is pressed.
 *
 * Every size here is read back from `PACK_MODELS` / `PACK_TOTAL_BYTES` rather
 * than written as a literal — except the total, which is asserted literally on
 * purpose: `402.2 MB` is the number the plan fixes as the one the user is
 * shown, so a manifest edit that moves it must fail this test rather than
 * silently agree with itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, vars?: Record<string, unknown>) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(vars?.[name] ?? ''))
        : _key,
  }),
}));

// The store module is imported only for its two derived constants; nothing
// here touches the disk, but ModelManager comes along for the ride.
vi.mock('../../../lib/local-inference/ModelManager', () => ({
  ModelManager: { getInstance: vi.fn() },
}));

const { default: SegmentationDownloadModal } = await import('./SegmentationDownloadModal');
const { PACK_MODELS, PACK_TOTAL_BYTES } = await import('../../../stores/segmentationStore');
const { formatBytes } = await import('../../../lib/local-inference/formatBytes');

const onConfirm = vi.fn();
const onClose = vi.fn();

const renderModal = (isOpen = true) =>
  render(<SegmentationDownloadModal isOpen={isOpen} onConfirm={onConfirm} onClose={onClose} />);

beforeEach(() => {
  cleanup();
  onConfirm.mockClear();
  onClose.mockClear();
});

describe('SegmentationDownloadModal', () => {
  it('renders nothing when closed', () => {
    const { container } = renderModal(false);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists all three models with their sizes and the total', () => {
    renderModal();
    expect(PACK_MODELS).toHaveLength(3);
    for (const model of PACK_MODELS) {
      expect(screen.getByText(model.name)).toBeTruthy();
      expect(screen.getByText(formatBytes(model.sizeBytes))).toBeTruthy();
    }
    expect(screen.getByText('Total')).toBeTruthy();
    expect(formatBytes(PACK_TOTAL_BYTES)).toBe('402.2 MB');
    // Once in the total row, once on the confirm button.
    expect(screen.getAllByText(/402\.2 MB/)).toHaveLength(2);
  });

  it('says what the download is for', () => {
    renderModal();
    expect(screen.getByText(/three models, one per language group/i)).toBeTruthy();
  });

  it('Cancel closes without confirming', () => {
    renderModal();
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('the confirm button carries the total and confirms', () => {
    renderModal();
    const confirm = screen.getByText('Download 402.2 MB').closest('button')!;
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
