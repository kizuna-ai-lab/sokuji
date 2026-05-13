import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AppProviders } from './AppProviders';
import { usePostHog } from '../contexts/PostHogContext';

describe('AppProviders', () => {
  it('renders children inside the provider chain', () => {
    render(
      <AppProviders posthogClient={null}>
        <div data-testid="child">hello</div>
      </AppProviders>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('exposes posthogClient via usePostHog (proves the provider is actually mounted)', () => {
    const fakeClient = { capture: () => undefined } as unknown as Parameters<typeof AppProviders>[0]['posthogClient'];
    const Consumer = () => {
      const client = usePostHog();
      return <div data-testid="ph">{client === fakeClient ? 'matched' : 'no-match'}</div>;
    };
    render(
      <AppProviders posthogClient={fakeClient}>
        <Consumer />
      </AppProviders>,
    );
    expect(screen.getByTestId('ph').textContent).toBe('matched');
  });
});
