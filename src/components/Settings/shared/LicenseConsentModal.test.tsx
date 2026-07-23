/**
 * LicenseConsentModal (Task 2 of the OmniVoice license-consent plan) — the
 * WarningModal-style acknowledge dialog shown before downloading a native
 * model card whose catalog descriptor carries a non-commercial license
 * (NativeModelCardSpec.license.nonCommercial).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LicenseConsentModal from './LicenseConsentModal';
import type { ModelLicense } from './LicenseConsentModal';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, vars?: Record<string, unknown>) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(vars?.[name] ?? ''))
        : fallback ?? _key,
  }),
}));

const license: ModelLicense = {
  spdx: 'CC-BY-NC-4.0',
  name: 'Creative Commons Attribution-NonCommercial 4.0',
  url: 'https://creativecommons.org/licenses/by-nc/4.0/',
  nonCommercial: true,
  sourceRepo: 'k2-fsa/some-model-repo',
  attribution: 'k2-fsa / sherpa-onnx',
};

describe('LicenseConsentModal', () => {
  it('renders nothing when license is absent', () => {
    const { container } = render(
      <LicenseConsentModal
        isOpen
        license={null}
        modelName="Some Model"
        onAccept={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when isOpen is false, even with a license present', () => {
    const { container } = render(
      <LicenseConsentModal
        isOpen={false}
        license={license}
        modelName="Some Model"
        onAccept={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the source repo, the true license name/SPDX, a non-commercial reminder, a disclaimer, and attribution', () => {
    render(
      <LicenseConsentModal
        isOpen
        license={license}
        modelName="Some Model"
        onAccept={vi.fn()}
        onClose={vi.fn()}
      />
    );

    // Repo it downloads from.
    expect(screen.getByText(/k2-fsa\/some-model-repo/)).toBeInTheDocument();
    // The TRUE license (name + SPDX), not a generic OSS license.
    expect(screen.getByText(/Creative Commons Attribution-NonCommercial 4\.0/)).toBeInTheDocument();
    expect(screen.getByText(/CC-BY-NC-4\.0/)).toBeInTheDocument();
    // Non-commercial-use reminder.
    expect(screen.getByText(/non-commercial use only/i)).toBeInTheDocument();
    // Disclaimer: no relationship/warranty, unofficial.
    expect(screen.getByText(/not affiliated/i)).toBeInTheDocument();
    expect(screen.getByText(/unofficial/i)).toBeInTheDocument();
    // Attribution.
    expect(screen.getByText(/k2-fsa \/ sherpa-onnx/)).toBeInTheDocument();
    // Link to the full license text.
    expect(screen.getByRole('link')).toHaveAttribute('href', license.url);

    // Footer actions.
    expect(screen.getByRole('button', { name: /i understand/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('calls onAccept when the primary button is clicked', () => {
    const onAccept = vi.fn();
    const onClose = vi.fn();
    render(
      <LicenseConsentModal isOpen license={license} modelName="Some Model" onAccept={onAccept} onClose={onClose} />
    );
    fireEvent.click(screen.getByRole('button', { name: /i understand/i }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when Cancel is clicked, not onAccept', () => {
    const onAccept = vi.fn();
    const onClose = vi.fn();
    render(
      <LicenseConsentModal isOpen license={license} modelName="Some Model" onAccept={onAccept} onClose={onClose} />
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });
});
