// src/viewer/Segmented.test.tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import Segmented from './Segmented';

afterEach(cleanup);

describe('Segmented', () => {
  // A pair whose two codes were briefly equal (two blanks before the host's
  // provider loaded) gave two options the same value; keyed by value, React
  // kept the stale button after the real pair arrived: "| English | Both | Japanese".
  it('shows exactly the current options after options that repeated a value', () => {
    const onChange = () => {};
    const { rerender } = render(
      <Segmented label="I read" value="both" onChange={onChange}
        options={[{ value: '', label: '' }, { value: 'both', label: 'Both' }, { value: '', label: '' }]} />,
    );
    rerender(
      <Segmented label="I read" value="both" onChange={onChange}
        options={[{ value: 'en', label: 'English' }, { value: 'both', label: 'Both' }, { value: 'ja', label: 'Japanese' }]} />,
    );
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['English', 'Both', 'Japanese']);
  });
});
