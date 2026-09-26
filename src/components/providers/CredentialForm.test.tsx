import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CredentialField } from '../../lib/provider/types';
import { CredentialForm } from './CredentialForm';

// Every label resolves to its key, so the inputs are found by the i18n key their field names.
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) };
});

const appId: CredentialField = { key: 'appId', labelKey: 'setup.credentials.appId', secret: false };
const token: CredentialField = { key: 'accessToken', labelKey: 'setup.credentials.accessToken', secret: true };
const unknown = { state: 'unknown' } as const;

describe('CredentialForm', () => {
  it('draws one input per field, masking secrets, and reports typing by key', () => {
    const onChange = vi.fn();
    render(<CredentialForm fields={[appId, token]} values={{ appId: 'a1', accessToken: '' }} readiness={unknown} onChange={onChange} onCheck={vi.fn()} />);
    const id = screen.getByLabelText('setup.credentials.appId') as HTMLInputElement;
    const secret = screen.getByLabelText('setup.credentials.accessToken') as HTMLInputElement;
    expect(id.type).toBe('text');
    expect(id.value).toBe('a1');
    expect(secret.type).toBe('password');
    fireEvent.change(secret, { target: { value: 't1' } });
    expect(onChange).toHaveBeenCalledWith('accessToken', 't1');
  });

  it('puts the check beside the last field, enabled only once every field is filled', () => {
    const onCheck = vi.fn();
    const { rerender } = render(<CredentialForm fields={[appId, token]} values={{ appId: 'a1', accessToken: '' }} readiness={unknown} onChange={vi.fn()} onCheck={onCheck} />);
    const groups = document.querySelectorAll('.api-key-input-group');
    expect(groups).toHaveLength(2);
    expect(groups[0].querySelector('.validate-button')).toBeNull();
    const button = groups[1].querySelector('.validate-button') as HTMLButtonElement;
    expect(button).toBeDisabled();
    rerender(<CredentialForm fields={[appId, token]} values={{ appId: 'a1', accessToken: 't1' }} readiness={unknown} onChange={vi.fn()} onCheck={onCheck} />);
    fireEvent.click(button);
    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  it('offers the check alone when the provider has no fields', () => {
    const onCheck = vi.fn();
    render(<CredentialForm fields={[]} values={{}} readiness={unknown} onChange={vi.fn()} onCheck={onCheck} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button'));
    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  it('disables the check while it runs', () => {
    render(<CredentialForm fields={[]} values={{}} readiness={{ state: 'checking' }} onChange={vi.fn()} onCheck={vi.fn()} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('marks the inputs valid when ready', () => {
    render(<CredentialForm fields={[token]} values={{ accessToken: 't1' }} readiness={{ state: 'ready', models: [] }} onChange={vi.fn()} onCheck={vi.fn()} />);
    expect(screen.getByLabelText('setup.credentials.accessToken')).toHaveClass('api-key-input', 'valid');
  });

  it('marks the inputs invalid and shows the reason when not ready', () => {
    render(<CredentialForm fields={[token]} values={{ accessToken: 't1' }} readiness={{ state: 'not-ready', reason: 'bad key' }} onChange={vi.fn()} onCheck={vi.fn()} />);
    expect(screen.getByLabelText('setup.credentials.accessToken')).toHaveClass('api-key-input', 'invalid');
    expect(screen.getByText('bad key')).toHaveClass('validation-message', 'error');
  });

  it('draws no check button without onCheck and without fields: a local provider checks itself', () => {
    render(<CredentialForm fields={[]} values={{}} readiness={unknown} onChange={vi.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.querySelector('.api-key-input-group')).toBeNull();
  });

  it('shows a coded not-ready reason in its words', () => {
    render(<CredentialForm fields={[]} values={{}} readiness={{ state: 'not-ready', reason: 'diagnostic', code: 'local_models_missing' }} onChange={vi.fn()} />);
    expect(screen.getByText('notices.local_models_missing')).toHaveClass('validation-message', 'error');
  });
});
