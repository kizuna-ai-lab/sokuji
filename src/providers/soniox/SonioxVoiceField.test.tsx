import { describe, it, expect, vi } from 'vitest';
import { render, renderHook } from '@testing-library/react';
import type { ProviderAccount } from '../../lib/provider/types';
import type { SonioxRegion } from '../../lib/soniox/regions';
import type { VoiceLibrarySource } from '../../components/Settings/sections/voiceLibrarySource';
import type { SonioxVoiceSectionProps } from '../../components/Settings/sections/SonioxVoiceSection';
import { SONIOX_DEFAULTS } from './settings';

const seen: SonioxVoiceSectionProps[] = [];
vi.mock('../../components/Settings/sections/SonioxVoiceSection', () => ({
  default: (props: SonioxVoiceSectionProps) => {
    seen.push(props);
    return null;
  },
}));

import { SonioxVoiceField, useByokVoiceSource } from './SonioxVoiceField';

const account = (credentials: Record<string, string>): ProviderAccount => ({
  credentials,
  auth: { signedIn: false, getToken: async () => null },
});

describe('SonioxVoiceField', () => {
  it("hands the section the region's voice, key and speed, the pair's target, and writes the region's voice field", () => {
    const update = vi.fn();
    render(
      <SonioxVoiceField
        settings={{ ...SONIOX_DEFAULTS, region: 'jp', voiceJp: 'Clone-1', ttsSpeed: 1.1 }}
        update={update}
        disabled={false}
        target="fr"
        account={account({ apiKeyJp: 'k-jp' })}
        managed={false}
        useVoiceSource={() => null}
      />
    );
    const last = seen[seen.length - 1];
    expect(last.settings).toEqual({ voice: 'Clone-1', apiKey: 'k-jp', targetLanguage: 'fr', ttsSpeed: 1.1, region: 'jp' });
    expect(last.managed).toBe(false);
    expect(last.isSessionActive).toBe(false);
    last.onUpdate({ voice: 'Other' });
    expect(update).toHaveBeenCalledWith({ voiceJp: 'Other' });
  });

  it("passes an injected source and the managed flag through (Plan B's seam)", () => {
    const stubSource: VoiceLibrarySource = {
      list: async () => [],
      create: async () => { throw new Error('not used'); },
      delete: async () => {},
      waitUntilReady: async () => { throw new Error('not used'); },
      canPreview: false,
    };
    render(
      <SonioxVoiceField
        settings={SONIOX_DEFAULTS}
        update={() => {}}
        disabled={false}
        target="en"
        managed
        useVoiceSource={() => stubSource}
      />
    );
    const last = seen[seen.length - 1];
    expect(last.source).toBe(stubSource);
    expect(last.managed).toBe(true);
  });

  describe('useByokVoiceSource', () => {
    it('none without the region\'s key; a source with preview for one; the same source until that key or the region changes', () => {
      const { result, rerender } = renderHook(
        ({ a, r }: { a: ProviderAccount; r: SonioxRegion }) => useByokVoiceSource(a, r),
        { initialProps: { a: account({}), r: 'us' as SonioxRegion } }
      );
      expect(result.current).toBeNull();

      rerender({ a: account({ apiKey: 'k' }), r: 'us' });
      const first = result.current;
      expect(first).not.toBeNull();
      expect(first!.canPreview).toBe(true);
      expect(first!.cacheNamespace).toBe('soniox:us');

      // A new account object, same effective key: the memo must not churn.
      rerender({ a: account({ apiKey: 'k', apiKeyEu: 'other' }), r: 'us' });
      expect(result.current).toBe(first);

      rerender({ a: account({ apiKey: 'k2' }), r: 'us' });
      expect(result.current).not.toBe(first);

      rerender({ a: account({ apiKeyEu: 'e' }), r: 'eu' });
      expect(result.current!.cacheNamespace).toBe('soniox:eu');
    });
  });
});
