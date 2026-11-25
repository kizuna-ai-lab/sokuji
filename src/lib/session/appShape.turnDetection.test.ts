// A session takes the turn detection settings as they stand at Start.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: async () => ({ success: true }) }) },
}));

import { readShapeFromStores } from './appShape';
import { FAKE_DEFAULTS } from '../../providers/fake/settings';
import { useProviderStore } from '../../stores/providerStore';
import { useTurnDetectionStore } from '../../stores/turnDetectionStore';
import { TURN_DETECTION_DEFAULTS } from '../turn/turnDetectionSettings';

import { runsOn } from '../../stores/lineUpStore.testing';
const auth = { signedIn: false, getToken: async () => null };

beforeEach(() => {
  runsOn('fake');
  useProviderStore.setState({
    legs: ['speaker'],
    entries: { fake: { settings: FAKE_DEFAULTS, credentials: { apiKey: 'k' }, pair: { source: 'en', target: 'ja' } } },
  });
  useTurnDetectionStore.setState({ settings: TURN_DETECTION_DEFAULTS });
});

describe('turn detection reaches the shape', () => {
  it('carries the store value of the moment of Start into shared.turnDetection', () => {
    const custom = { ...TURN_DETECTION_DEFAULTS, threshold: 0.55, minSilence: 0.7, endOfTurn: 'smart' as const };
    useTurnDetectionStore.setState({ settings: custom });
    expect(readShapeFromStores(auth)!.shared.turnDetection).toEqual(custom);
  });
});
