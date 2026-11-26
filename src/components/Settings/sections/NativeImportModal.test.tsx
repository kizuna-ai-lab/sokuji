import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';

const store = vi.hoisted(() => ({ modelFiles: vi.fn(), importFiles: vi.fn(async () => {}) }));
vi.mock('../../../stores/nativeModelStore', () => ({
  useNativeModelStore: Object.assign((sel: Function) => sel(store), { getState: () => store }),
}));
// The WASM/WebGPU engine's store, which the shared window reads for its own default backend.
vi.mock('../../../stores/modelStore', () => ({
  useModelStore: (sel: Function) => sel({ importModel: vi.fn() }),
}));

import '../../../locales';
import { NativeImportModal } from './NativeImportModal';

// jsdom's Blob has no arrayBuffer(), which the window's file check reads the first bytes through.
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as ArrayBuffer);
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(this);
    });
  };
}

const FILES = [{ repo: 'handy-computer/x-gguf', file: 'dir/x-Q8_0.gguf', url: 'https://huggingface.co/handy-computer/x-gguf/resolve/main/dir/x-Q8_0.gguf', size: 2048 }];
const pathFor = vi.fn();

beforeEach(() => {
  store.modelFiles.mockReset().mockResolvedValue(FILES);
  store.importFiles.mockClear();
  pathFor.mockReset().mockImplementation((f: { name: string }) => `/home/me/${f.name}`);
  (window as unknown as { nativeFiles: unknown }).nativeFiles = { pathFor };
});
afterEach(() => { cleanup(); delete (window as unknown as { nativeFiles?: unknown }).nativeFiles; });

const mount = (onClose = vi.fn()) => {
  render(<NativeImportModal isOpen onClose={onClose} modelId="x" modelName="Model X" repo="handy-computer/x-gguf/dir/x-Q8_0.gguf" />);
  return onClose;
};
// 2048 bytes by default: the size the catalog lists in these tests.
const gguf = (name = 'x-Q8_0.gguf', body = `GGUF${'.'.repeat(2044)}`) => new File([body], name);
const addFiles = (...files: File[]) => {
  const input = document.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;   // "Choose files"
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  fireEvent.change(input);
};

describe('NativeImportModal — the shared import window over the native engine', () => {
  it('is the same window as the WASM/WebGPU engine\'s: the repository, the command and the file the model is made of', async () => {
    mount();
    expect(await screen.findByText('dir/x-Q8_0.gguf')).toBeInTheDocument();
    expect(screen.getByText('handy-computer/x-gguf')).toBeInTheDocument();
    expect(document.querySelector('.import-cmd__term pre')?.textContent).toContain('hf download handy-computer/x-gguf');
    expect(document.querySelector('.import-cmd__term pre')?.textContent).toContain('dir/x-Q8_0.gguf');
    expect(store.modelFiles).toHaveBeenCalledWith('x', 'handy-computer/x-gguf/dir/x-Q8_0.gguf');
  });

  it('hands the engine the paths of the files chosen, for the chosen variant, once they match', async () => {
    const onClose = mount();
    await screen.findByText('dir/x-Q8_0.gguf');
    addFiles(gguf());
    const importBtn = await screen.findByRole('button', { name: /Import (& finish|1 now)/ });
    await waitFor(() => expect(importBtn).toBeEnabled());
    fireEvent.click(importBtn);
    await waitFor(() => expect(store.importFiles).toHaveBeenCalledWith('x', ['/home/me/x-Q8_0.gguf'], 'handy-computer/x-gguf/dir/x-Q8_0.gguf'));
    expect(onClose).toHaveBeenCalled();
  });

  it('refuses an empty file in the window, before the engine hears of it', async () => {
    mount();
    await screen.findByText('dir/x-Q8_0.gguf');
    addFiles(gguf('x-Q8_0.gguf', ''));
    await waitFor(() => expect(document.querySelector('.import-file--invalid')).not.toBeNull());
    expect(within(document.querySelector('.import-file--invalid') as HTMLElement).getByText(/empty/)).toBeInTheDocument();
    expect(store.importFiles).not.toHaveBeenCalled();
  });

  it('refuses a file far from the size the catalog lists, as soon as it is chosen', async () => {
    mount();
    await screen.findByText('dir/x-Q8_0.gguf');
    addFiles(gguf('x-Q8_0.gguf', 'GGUF....'));   // 8 bytes, where the catalog says 2048
    await waitFor(() => expect(document.querySelector('.import-file--invalid')).not.toBeNull());
    expect(within(document.querySelector('.import-file--invalid') as HTMLElement).getByText(/size mismatch/i)).toBeInTheDocument();
  });

  it('shows the size where the catalog lists it, and says so when the files cannot be looked up', async () => {
    mount();
    expect(await screen.findByText(/2\.0 KB|2 KB|2\.00 KB/)).toBeInTheDocument();
    cleanup();
    store.modelFiles.mockRejectedValue(new Error('engine down'));
    mount();
    expect(await screen.findByText(/engine down/)).toBeInTheDocument();
  });

  it('does not talk of an onnx/ subfolder, which is the WASM/WebGPU engine\'s way: a native model is a file or two', async () => {
    mount();
    await screen.findByText('dir/x-Q8_0.gguf');
    expect(screen.queryByText(/onnx/)).toBeNull();
    expect(screen.getByText('Choose the downloaded file(s). Keep their names as they are.')).toBeInTheDocument();
  });

  it('says so, in the window, when a chosen file has no location, instead of sending the engine nothing', async () => {
    pathFor.mockReturnValue('');
    mount();
    await screen.findByText('dir/x-Q8_0.gguf');
    addFiles(gguf());
    const importBtn = await screen.findByRole('button', { name: /Import (& finish|1 now)/ });
    await waitFor(() => expect(importBtn).toBeEnabled());
    fireEvent.click(importBtn);
    expect(await screen.findByText(/location of a chosen file could not be read/)).toBeInTheDocument();
    expect(store.importFiles).not.toHaveBeenCalled();
  });
});
