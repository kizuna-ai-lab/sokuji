import { describe, it, expect, beforeEach } from 'vitest';
import useUpdateStore from './updateStore';

describe('updateStore', () => {
  beforeEach(() => {
    useUpdateStore.setState({
      status: 'idle',
      newVersion: null,
      changelog: null,
      downloadProgress: 0,
      downloadSpeed: 0,
      downloadTransferred: 0,
      downloadTotal: 0,
      errorMessage: null,
      downloadUrl: null,
      supportsAutoUpdate: true,
      appImageUrl: null,
      debUrl: null,
      releasePageUrl: null,
      bannerDismissed: false,
      dialogOpen: false,
    });
  });

  it('defaults supportsAutoUpdate to true (matches Windows behavior)', () => {
    expect(useUpdateStore.getState().supportsAutoUpdate).toBe(true);
  });

  it('exposes appImageUrl, debUrl, releasePageUrl as null by default', () => {
    const s = useUpdateStore.getState();
    expect(s.appImageUrl).toBeNull();
    expect(s.debUrl).toBeNull();
    expect(s.releasePageUrl).toBeNull();
  });

  it('allows setting the new fields', () => {
    useUpdateStore.setState({
      supportsAutoUpdate: false,
      appImageUrl: 'https://example.com/app.AppImage',
      debUrl: 'https://example.com/app.deb',
      releasePageUrl: 'https://example.com/release',
    });
    const s = useUpdateStore.getState();
    expect(s.supportsAutoUpdate).toBe(false);
    expect(s.appImageUrl).toBe('https://example.com/app.AppImage');
    expect(s.debUrl).toBe('https://example.com/app.deb');
    expect(s.releasePageUrl).toBe('https://example.com/release');
  });
});
