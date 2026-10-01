import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fb?: string) => fb ?? _k }),
}));

import type { NativeModelInfo } from '../../lib/local-inference/native/nativeProtocol';
import { useNativeModelStore } from '../../stores/nativeModelStore';
import { LocalNativeSettingsView } from './LocalNativeSettings';
import { LOCAL_NATIVE_DEFAULTS } from './settings';

const cpu = [{ tier: 'cpu', backend: 'ct2', available: true }];
const M = (id: string, kind: NativeModelInfo['kind'], languages: string[]): NativeModelInfo =>
  ({ id, name: id, kind, languages, recommended: true, tiers: cpu, order: 1, repo: id }) as NativeModelInfo;

beforeEach(() => {
  useNativeModelStore.setState({ catalog: { 'mt-a': M('mt-a', 'translate', ['multi']) }, statuses: { 'mt-a': 'ready' } });
});

describe('LocalNativeSettingsView', () => {
  it('offers the speed only where the target has a native voice', () => {
    const { rerender } = render(<LocalNativeSettingsView settings={LOCAL_NATIVE_DEFAULTS} update={vi.fn()} pair={{ source: 'ja', target: 'en' }} />);
    expect(screen.queryByLabelText('Speech Speed')).toBeNull();
    useNativeModelStore.setState({ catalog: { 'mt-a': M('mt-a', 'translate', ['multi']), 'tts-a': M('tts-a', 'tts', ['en']) } });
    rerender(<LocalNativeSettingsView settings={LOCAL_NATIVE_DEFAULTS} update={vi.fn()} pair={{ source: 'ja', target: 'en' }} />);
    expect(screen.getByLabelText('Speech Speed')).toBeTruthy();
  });

  it('shows the translation prompt control (#526 decides whether it is enabled)', () => {
    render(<LocalNativeSettingsView settings={LOCAL_NATIVE_DEFAULTS} update={vi.fn()} pair={{ source: 'ja', target: 'en' }} />);
    expect(screen.getByText('Translation Prompt')).toBeTruthy();
  });
});
