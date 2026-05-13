import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AppProviders } from './AppProviders';

describe('AppProviders', () => {
  it('renders children inside the provider chain', () => {
    render(
      <AppProviders posthogClient={null}>
        <div data-testid="child">hello</div>
      </AppProviders>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('accepts null posthogClient (used by overlay iframe)', () => {
    render(
      <AppProviders posthogClient={null}>
        <span>x</span>
      </AppProviders>,
    );
    // Should not throw.
    expect(screen.getByText('x')).toBeInTheDocument();
  });
});
