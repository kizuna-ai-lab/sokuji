import { describe, it, expect } from 'vitest';
import { buildTourCtx } from './tourContext';
import { Provider } from '../../types/Provider';

const base = {
  record: null,
  provider: Provider.OPENAI,
  mode: 'speaker' as const,
  textOnly: false,
  isSignedIn: false,
  apiKeyValid: null,
};
const env = (over: Partial<{ isElectron: boolean; isExtension: boolean }>) => ({
  isElectron: false, isExtension: false, isLinux: false, isMacOS: false, isWindows: true, ...over,
});

describe('buildTourCtx platform', () => {
  it('reports electron, extension and — for a plain browser build — web', () => {
    // Three, not two: a dev build in a plain browser renders neither the
    // subtitle button nor anything else extension-only, so the steps that need
    // those surfaces must be able to exclude it by predicate.
    expect(buildTourCtx({ ...base, env: env({ isElectron: true }) }).platform).toBe('electron');
    expect(buildTourCtx({ ...base, env: env({ isExtension: true }) }).platform).toBe('extension');
    expect(buildTourCtx({ ...base, env: env({}) }).platform).toBe('web');
  });

  it('prefers electron when the environment claims both', () => {
    expect(buildTourCtx({ ...base, env: env({ isElectron: true, isExtension: true }) }).platform).toBe('electron');
  });
});
