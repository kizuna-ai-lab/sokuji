import React from 'react';
import { User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';
import { CircleHelp } from 'lucide-react';
import { UserAccountInfo } from '../../Auth/UserAccountInfo';
import { SignedIn, SignedOut } from '../../Auth/AuthGuard';
import { isKizunaAIEnabled } from '../../../utils/environment';

interface AccountSectionProps {
  /** Additional class name */
  className?: string;
}

const AccountSection: React.FC<AccountSectionProps> = ({ className = '' }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Only show if Kizuna AI is enabled
  if (!isKizunaAIEnabled()) {
    return null;
  }

  return (
    <div className={`config-section ${className}`} id="user-account-section">
      <h3>
        <User size={18} />
        <span>{t('simpleConfig.userAccount', 'User Account')}</span>
        <Tooltip
          content={t('simpleConfig.userAccountTooltip', 'For users with technical knowledge and their own API keys, you can use your own API key whether logged in or not. User Account is designed for new users who prefer a simplified setup without complex configuration.')}
          position="top"
        >
          <CircleHelp className="lucide lucide-circle-help tooltip-trigger" size={14} />
        </Tooltip>
      </h3>

      <SignedIn>
        <UserAccountInfo />
      </SignedIn>

      <SignedOut>
        <div className="sign-in-prompt">
          <p>{t('simpleConfig.signInRequired', 'You can use your own AI provider and API key without logging in, or sign up to purchase and use kizuna.ai\'s API service.')}</p>
          <div className="auth-buttons">
            <button
              className="sign-in-button"
              onClick={() => navigate('/sign-in')}
            >
              {t('common.signIn', 'Sign In')}
            </button>
            <button
              className="sign-up-button"
              onClick={() => navigate('/sign-up')}
            >
              {t('common.signUp', 'Sign Up')}
            </button>
          </div>
        </div>
      </SignedOut>
    </div>
  );
};

export default AccountSection;
