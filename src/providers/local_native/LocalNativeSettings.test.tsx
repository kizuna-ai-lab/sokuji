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

  it("offers the prompt on the model of the direction that runs, not on either direction's (#526)", () => {
    useNativeModelStore.setState({
      catalog: { 'mt-a': M('mt-a', 'translate', ['multi']), 'translategemma-4b': M('translategemma-4b', 'translate', ['multi']) },
      statuses: { 'mt-a': 'ready', 'translategemma-4b': 'ready' },
    });
    // ja→en translates with the model that owns its prompt; en→ja with one that takes the text.
    const settings = {
      ...LOCAL_NATIVE_DEFAULTS,
      selections: {
        'ja→en': { asr: { modelId: '' }, translation: { modelId: 'translategemma-4b' }, tts: { modelId: '' } },
        'en→ja': { asr: { modelId: '' }, translation: { modelId: 'mt-a' }, tts: { modelId: '' } },
      },
    };
    const swapped = {
      ...settings,
      selections: {
        'ja→en': settings.selections['en→ja'],
        'en→ja': settings.selections['ja→en'],
      },
    };
    const supported = (c: HTMLElement) => c.querySelector('#local-translation-prompt-section')!.getAttribute('aria-disabled') === 'false';
    const view = (s: typeof settings, legs: readonly ('speaker' | 'participant')[]) => (
      <LocalNativeSettingsView settings={s} update={vi.fn()} pair={{ source: 'ja', target: 'en' }} legs={legs} />
    );
    const { container, rerender } = render(view(settings, ['speaker']));
    expect(supported(container)).toBe(false);
    expect([...container.querySelectorAll<HTMLButtonElement>('.option-button')].every((b) => b.disabled)).toBe(true);
    rerender(view(settings, ['participant']));
    expect(supported(container)).toBe(true);
    expect([...container.querySelectorAll<HTMLButtonElement>('.option-button')].some((b) => b.disabled)).toBe(false);
    rerender(view(swapped, ['participant']));
    expect(supported(container)).toBe(false);
    rerender(view(swapped, ['speaker']));
    expect(supported(container)).toBe(true);
  });
});
