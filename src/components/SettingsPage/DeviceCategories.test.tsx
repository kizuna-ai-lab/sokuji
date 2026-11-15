// "Models and storage" lists what is downloaded whatever provider is selected (PR review).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const scan = vi.hoisted(() => ({ initialize: vi.fn(async () => {}), initialized: false }));
vi.mock('../../stores/modelStore', () => ({
  useModelStore: { getState: () => ({ initialize: scan.initialize, initialized: scan.initialized }) },
}));
vi.mock('./ModelsPage', () => ({ ModelsPage: () => <div data-testid="storage" /> }));

import { ModelsCategory } from './DeviceCategories';
import { useProviderStore } from '../../stores/providerStore';

afterEach(() => { cleanup(); scan.initialize.mockClear(); scan.initialized = false; });

describe('models and storage', () => {
  it('scans the downloaded models on opening, with a network provider selected', () => {
    useProviderStore.setState({ selected: 'soniox' });
    render(<ModelsCategory locked={false} />);
    expect(scan.initialize).toHaveBeenCalledTimes(1);
  });

  it('does not scan again once the models are known', () => {
    scan.initialized = true;
    render(<ModelsCategory locked={false} />);
    expect(scan.initialize).not.toHaveBeenCalled();
  });
});
