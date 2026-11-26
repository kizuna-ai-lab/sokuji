import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const store = vi.hoisted(() => ({ modelFiles: vi.fn(), importFiles: vi.fn(async () => {}) }));
vi.mock('../../../stores/nativeModelStore', () => ({
  useNativeModelStore: Object.assign((sel: Function) => sel(store), { getState: () => store }),
}));
const opened = vi.hoisted(() => [] as string[]);
vi.mock('../../../utils/openExternalUrl', () => ({ openExternalUrl: (u: string) => { opened.push(u); } }));

import '../../../locales';
import { NativeImportModal } from './NativeImportModal';

const FILES = [{ repo: 'handy-computer/x-gguf', file: 'dir/x-Q8_0.gguf', url: 'https://huggingface.co/handy-computer/x-gguf/resolve/main/dir/x-Q8_0.gguf' }];
const invoke = vi.fn();

beforeEach(() => {
  store.modelFiles.mockReset().mockResolvedValue(FILES);
  store.importFiles.mockClear();
  invoke.mockReset();
  opened.length = 0;
  (window as unknown as { electron: unknown }).electron = { invoke };
});
afterEach(() => { cleanup(); delete (window as unknown as { electron?: unknown }).electron; });

const mount = (onClose = vi.fn()) => {
  render(<NativeImportModal isOpen onClose={onClose} modelId="x" modelName="Model X" repo="handy-computer/x-gguf/dir/x-Q8_0.gguf" />);
  return onClose;
};

describe('NativeImportModal', () => {
  it('names the file the model is made of and where it is published, asked for the chosen variant', async () => {
    mount();
    expect(await screen.findByText('x-Q8_0.gguf')).toBeInTheDocument();
    expect(screen.getByText(/handy-computer\/x-gguf/)).toBeInTheDocument();
    expect(store.modelFiles).toHaveBeenCalledWith('x', 'handy-computer/x-gguf/dir/x-Q8_0.gguf');
    fireEvent.click(screen.getByRole('button', { name: /Open the download page/ }));
    expect(opened).toEqual([FILES[0].url]);
  });

  it('imports the files the person chooses, for the chosen variant, and closes', async () => {
    invoke.mockResolvedValue({ ok: true, paths: ['/home/me/x-Q8_0.gguf'] });
    const onClose = mount();
    await screen.findByText('x-Q8_0.gguf');
    fireEvent.click(screen.getByRole('button', { name: /Choose files/ }));
    await waitFor(() => expect(store.importFiles).toHaveBeenCalledWith('x', ['/home/me/x-Q8_0.gguf'], 'handy-computer/x-gguf/dir/x-Q8_0.gguf'));
    expect(invoke).toHaveBeenCalledWith('native-models:pick-files', expect.objectContaining({ title: expect.any(String) }));
    expect(onClose).toHaveBeenCalled();
  });

  it('does nothing when the person cancels the dialog', async () => {
    invoke.mockResolvedValue({ ok: true, paths: [] });
    const onClose = mount();
    await screen.findByText('x-Q8_0.gguf');
    fireEvent.click(screen.getByRole('button', { name: /Choose files/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(store.importFiles).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('says so when the files cannot be looked up, and offers no choice', async () => {
    store.modelFiles.mockRejectedValue(new Error('engine down'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('engine down');
    expect(screen.getByRole('button', { name: /Choose files/ })).toBeDisabled();
  });
});
