import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SonioxCloneReviewStep, { type SonioxCloneReviewStepProps } from './SonioxCloneReviewStep';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key) }),
}));

const base: SonioxCloneReviewStepProps = { audioBlob: null, error: null, busy: false, onConfirm: () => {}, onClose: () => {} };
const language = (patch: Partial<NonNullable<SonioxCloneReviewStepProps['language']>> = {}) => ({
  label: 'Language of the recording',
  options: [{ value: 'hu', label: 'Hungarian' }, { value: 'ja', label: 'Japanese' }],
  value: 'hu',
  onChange: vi.fn(),
  ...patch,
});
const confirm = () => screen.getByRole('button', { name: 'Clone voice' });
const consent = () => fireEvent.click(screen.getByRole('checkbox'));

describe('SonioxCloneReviewStep: the sample language', () => {
  it('without language, renders no select and Confirm needs only consent', () => {
    render(<SonioxCloneReviewStep {...base} />);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(confirm()).toBeDisabled();
    consent();
    expect(confirm()).toBeEnabled();
  });

  it('with language, renders a labelled select listing the options with value preselected', () => {
    render(<SonioxCloneReviewStep {...base} language={language()} />);
    const select = screen.getByRole('combobox', { name: 'Language of the recording' }) as HTMLSelectElement;
    expect(select.value).toBe('hu');
    expect(Array.from(select.options).filter((o) => o.value).map((o) => [o.value, o.textContent])).toEqual([['hu', 'Hungarian'], ['ja', 'Japanese']]);
  });

  it("with language value '', Confirm stays disabled even with consent ticked", () => {
    render(<SonioxCloneReviewStep {...base} language={language({ value: '' })} />);
    consent();
    expect(confirm()).toBeDisabled();
  });

  it('changing the select calls onChange with the option value', () => {
    const lang = language();
    render(<SonioxCloneReviewStep {...base} language={lang} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ja' } });
    expect(lang.onChange).toHaveBeenCalledWith('ja');
  });

  it('while busy, the select is disabled', () => {
    render(<SonioxCloneReviewStep {...base} busy language={language()} />);
    expect(screen.getByRole('combobox')).toBeDisabled();
  });
});
