import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const seen = vi.hoisted(() => ({ props: null as unknown }));
vi.mock('../Settings/sections/HelpSection', () => ({ default: (props: unknown) => { seen.props = props; return <div id="help-section">help</div>; } }));

import { GeneralCategory } from './GeneralCategory';

describe('general', () => {
  it("renders today's help section unchanged, with the session lock", () => {
    render(<GeneralCategory locked />);
    expect(screen.getByText('help')).toBeInTheDocument();
    expect(seen.props).toEqual({ isSessionActive: true });
  });
});
