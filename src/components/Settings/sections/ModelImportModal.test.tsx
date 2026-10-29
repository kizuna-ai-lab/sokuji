import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// t returns the inline English default so assertions read naturally.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: any, opts?: any) =>
    typeof d === 'string'
      ? d.replace(/\{\{(\w+)\}\}/g, (_m, n) => String(opts?.[n] ?? ''))
      : _k,
  }),
}));

const targets = {
  repo: 'onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX',
  variant: 'q4f16',
  files: [
    { filename: 'config.json', url: 'https://huggingface.co/x/resolve/main/config.json', sizeBytes: 2000 },
    { filename: 'onnx/audio_encoder_q4f16.onnx', url: 'https://huggingface.co/x/resolve/main/onnx/audio_encoder_q4f16.onnx', sizeBytes: 419000 },
  ],
};

// Swapped by tests that need a different hosting setup (e.g. non-huggingface.co targets).
let mockTargets = targets;

vi.mock('../../../lib/local-inference/ModelManager', () => ({
  ModelManager: { getInstance: () => ({ getModelFileTargets: () => mockTargets }) },
}));

const mockImportModel = vi.fn();
vi.mock('../../../stores/modelStore', () => ({
  useModelStore: (selector: any) => selector({ importModel: mockImportModel }),
}));

vi.mock('../../../lib/local-inference/modelStorage', () => ({
  hasFile: vi.fn(async () => false),
}));

// Skip real Blob byte reads (jsdom Blob lacks arrayBuffer); matching logic is what we test.
vi.mock('../../../lib/local-inference/modelFileValidation', () => ({
  validateModelFile: vi.fn(async () => {}),
  ModelFileValidationError: class extends Error {},
}));

import { ModelImportModal } from './ModelImportModal';

describe('ModelImportModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the three steps, the repo, the command, and the expected file list', async () => {
    render(<ModelImportModal isOpen modelId="voxtral-mini-4b-webgpu" modelName="Voxtral" onClose={() => {}} />);

    expect(screen.getByText('Get the files')).toBeInTheDocument();
    expect(screen.getByText('Add your files')).toBeInTheDocument();
    expect(screen.getByText('onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX')).toBeInTheDocument();
    // File list is populated from the effect.
    expect(await screen.findByText('config.json')).toBeInTheDocument();
    expect(screen.getByText('onnx/audio_encoder_q4f16.onnx')).toBeInTheDocument();
    // hf download command is shown by default (repo present).
    expect(screen.getByText(/hf download/)).toBeInTheDocument();
  });

  it('matches a picked file and enables importing the partial set', async () => {
    const { container } = render(
      <ModelImportModal isOpen modelId="voxtral-mini-4b-webgpu" modelName="Voxtral" onClose={() => {}} />,
    );
    await screen.findByText('config.json');

    // Import is disabled until at least one valid file is added.
    const importBtn = screen.getByRole('button', { name: /^Import$/ });
    expect(importBtn).toBeDisabled();

    // Pick config.json via the "Choose files" hidden input (2nd file input).
    const inputs = container.querySelectorAll('input[type="file"]');
    const filesInput = inputs[inputs.length - 1] as HTMLInputElement;
    const file = new File([new Uint8Array([0x7b])], 'config.json');
    fireEvent.change(filesInput, { target: { files: [file] } });

    // One of two files matched → partial import offered.
    await waitFor(() => expect(screen.getByText('1 / 2')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Import 1 now/ })).toBeEnabled();
  });

  it('keeps both files when two picks are batched into one commit (no lost update)', async () => {
    // Two picks that React batches into a single commit (no re-render between)
    // must not clobber each other. Reading the prior selection from a stale
    // closure would drop the earlier file. Raw dispatchEvent (unlike fireEvent,
    // which flushes act per call) keeps both changes inside one batch.
    const { container } = render(
      <ModelImportModal isOpen modelId="voxtral-mini-4b-webgpu" modelName="Voxtral" onClose={() => {}} />,
    );
    await screen.findByText('config.json');

    const inputs = container.querySelectorAll('input[type="file"]');
    const filesInput = inputs[inputs.length - 1] as HTMLInputElement;
    const cfg = new File([new Uint8Array([0x7b])], 'config.json');
    const onnx = new File([new Uint8Array([0x08])], 'audio_encoder_q4f16.onnx');
    const setFiles = (f: File) =>
      Object.defineProperty(filesInput, 'files', { value: [f], configurable: true });

    await act(async () => {
      setFiles(cfg);
      filesInput.dispatchEvent(new Event('change', { bubbles: true }));
      setFiles(onnx);
      filesInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await waitFor(() => expect(screen.getByText('2 / 2')).toBeInTheDocument());
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(
      <ModelImportModal isOpen modelId="voxtral-mini-4b-webgpu" modelName="Voxtral" onClose={onClose} />,
    );
    await screen.findByText('config.json');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('switches the shown commands to the hf-mirror.com source when picked (#539)', async () => {
    render(
      <ModelImportModal isOpen modelId="voxtral-mini-4b-webgpu" modelName="Voxtral" onClose={() => {}} />,
    );
    await screen.findByText('config.json');

    // Default source is huggingface.co: no HF_ENDPOINT prefix on the hf command.
    expect(screen.getByText(/hf download/)).toBeInTheDocument();
    expect(screen.queryByText(/HF_ENDPOINT/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'hf-mirror.com' }));

    // hf tab prefixes the mirror endpoint the mirror documents for the CLI.
    expect(screen.getByText(/HF_ENDPOINT=https:\/\/hf-mirror\.com/)).toBeInTheDocument();

    // curl tab rewrites the huggingface.co URLs to the mirror host.
    fireEvent.click(screen.getByRole('tab', { name: 'curl' }));
    const term = document.querySelector('.import-cmd__term pre');
    expect(term?.textContent).toContain('https://hf-mirror.com/x/resolve/main/config.json');
    expect(term?.textContent).not.toContain('huggingface.co');
  });

  it('resets the copy confirmation when the download source changes', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    render(
      <ModelImportModal isOpen modelId="voxtral-mini-4b-webgpu" modelName="Voxtral" onClose={() => {}} />,
    );
    await screen.findByText('config.json');

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();

    // Switching source replaces the command, so "Copied" would refer to a
    // command the clipboard no longer holds.
    fireEvent.click(screen.getByRole('button', { name: 'hf-mirror.com' }));
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('disables the mirror option when curl/wget targets are not hosted on huggingface.co', async () => {
    mockTargets = {
      ...targets,
      files: [{ filename: 'model.onnx', url: 'https://self-hosted.example.org/models/model.onnx', sizeBytes: 10 }],
    } as any;
    try {
      render(
        <ModelImportModal isOpen modelId="voxtral-mini-4b-webgpu" modelName="Voxtral" onClose={() => {}} />,
      );
      await screen.findByText('model.onnx');

      // The hf CLI tab still honours HF_ENDPOINT, so the mirror stays available.
      expect(screen.getByRole('button', { name: 'hf-mirror.com' })).toBeEnabled();

      // curl/wget leave non-huggingface.co URLs untouched, so the option is a
      // no-op there and must not look selectable.
      fireEvent.click(screen.getByRole('tab', { name: 'curl' }));
      expect(screen.getByRole('button', { name: 'hf-mirror.com' })).toBeDisabled();
    } finally {
      mockTargets = targets;
    }
  });
});
