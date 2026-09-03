import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import Modal from '../../Modal/Modal';
import type { NativeModelCardSpec } from '../../../lib/local-inference/native/nativeCatalog';

/** The shape of NativeModelCardSpec.license, named for reuse without re-declaring it here. */
export type ModelLicense = NonNullable<NativeModelCardSpec['license']>;

interface LicenseConsentModalProps {
  isOpen: boolean;
  license: ModelLicense | null | undefined;
  modelName: string;
  onAccept: () => void;
  onClose: () => void;
}

/**
 * Acknowledge-gate shown before downloading a native model card whose catalog
 * descriptor carries a license that has to be acknowledged (WarningModal-style,
 * built on the shared Modal primitive). The caller (NativeModelCard in
 * NativeModelManagementSection.tsx) only opens this when
 * `spec.license?.requiresConsent` is true and the model id hasn't already been
 * accepted (see stores/licenseConsentStore.ts); it does not gate this itself.
 *
 * Two wordings, picked by `license.nonCommercial`. A non-commercial license
 * (OmniVoice's CC-BY-NC-4.0) says so outright. A license that is merely
 * restricted — not OSI, with conditions, but commercial use permitted — must NOT
 * be described as non-commercial: IndexTTS 2.5's bilibili Model Use License
 * allows commercial use below a MAU/revenue ceiling, and telling the user
 * otherwise would be wrong in the direction that costs them a usable model.
 */
const LicenseConsentModal: React.FC<LicenseConsentModalProps> = ({ isOpen, license, modelName, onAccept, onClose }) => {
  const { t } = useTranslation();

  if (!license) return null;

  const nonCommercial = license.nonCommercial;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={nonCommercial
        ? t('models.licenseConsent.title', 'Non-commercial license')
        : t('models.licenseConsent.restrictedTitle', 'Restricted license')}
    >
      <div className="license-consent-modal">
        <div className="license-consent-modal__icon">
          <AlertTriangle size={16} color="#f0ad4e" />
        </div>
        <p>
          <strong>
            {t('models.licenseConsent.modelRepo', '{{model}} downloads from {{repo}}.', {
              model: modelName,
              repo: license.sourceRepo,
            })}
          </strong>
        </p>
        <p>
          {t('models.licenseConsent.licenseName', 'It is distributed under {{name}} ({{spdx}}).', {
            name: license.name,
            spdx: license.spdx,
          })}
          {license.url && (
            <>
              {' '}
              <a href={license.url} target="_blank" rel="noopener noreferrer">
                {t('models.licenseConsent.viewLicense', 'View the full license text')}
              </a>
            </>
          )}
        </p>
        <p>
          {nonCommercial
            ? t(
                'models.licenseConsent.nonCommercial',
                'This license permits non-commercial use only — do not use this model in any commercial product or service.'
              )
            : t(
                'models.licenseConsent.restrictedTerms',
                'This is not an open-source license. It sets conditions on how the model and its output may be used — read the full text before you rely on it.'
              )}
        </p>
        <p>
          {t(
            'models.licenseConsent.disclaimer',
            'Sokuji is not affiliated with the model authors and has no relationship with them. This integration is unofficial and provided as-is, without warranty of any kind.'
          )}
        </p>
        <p>
          {t('models.licenseConsent.attribution', 'Attribution: {{attribution}}', { attribution: license.attribution })}
        </p>
        <div className="license-consent-modal__actions">
          <button type="button" className="license-consent-modal__cancel" onClick={onClose}>
            {t('models.licenseConsent.cancel', 'Cancel')}
          </button>
          <button type="button" className="license-consent-modal__accept" onClick={onAccept}>
            {nonCommercial
              ? t('models.licenseConsent.accept', 'I understand — non-commercial only')
              : t('models.licenseConsent.acceptRestricted', 'I understand — accept the license')}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default LicenseConsentModal;
