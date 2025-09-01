import React from 'react';
import { useTranslation } from 'react-i18next';
import { User, Sparkles, Globe } from 'lucide-react';
import './UserTypeSelection.scss';
import { changeLanguageWithLoad } from '../../locales';

interface UserTypeSelectionProps {
  onSelectUserType: (type: 'regular' | 'experienced') => void;
}

const UserTypeSelection: React.FC<UserTypeSelectionProps> = ({ onSelectUserType }) => {
  const { t, i18n } = useTranslation();

  return (
    <div className="user-type-selection">
      <div className="language-selector">
        <Globe size={16} />
        <select
          value={i18n.language}
          onChange={async (e) => {
            await changeLanguageWithLoad(e.target.value);
          }}
          className="language-dropdown"
        >
          <option value="en">English</option>
          <option value="zh_CN">中文 (简体)</option>
          <option value="zh_TW">中文 (繁體)</option>
          <option value="ja">日本語</option>
          <option value="ko">한국어</option>
          <option value="es">Español</option>
          <option value="fr">Français</option>
          <option value="de">Deutsch</option>
          <option value="pt_BR">Português (Brasil)</option>
          <option value="pt_PT">Português (Portugal)</option>
          <option value="vi">Tiếng Việt</option>
          <option value="hi">हिन्दी</option>
        </select>
      </div>
      <div className="selection-container">
        <div className="selection-header">
          <h1>{t('userTypeSelection.title')}</h1>
          <p className="subtitle">{t('userTypeSelection.subtitle')}</p>
        </div>
        
        <div className="selection-cards">
          {/* Regular User Card - Left Side */}
          <button 
            className="user-card regular-user"
            onClick={() => onSelectUserType('regular')}
          >
            <div className="card-icon">
              <User size={64} />
            </div>
            <h2>{t('userTypeSelection.regular.title')}</h2>
            <p className="card-description">
              {t('userTypeSelection.regular.description')}
            </p>
            <ul className="card-features">
              <li>{t('userTypeSelection.regular.feature1')}</li>
              <li>{t('userTypeSelection.regular.feature2')}</li>
              <li>{t('userTypeSelection.regular.feature3')}</li>
            </ul>
            <div className="card-action">
              <span className="action-text">{t('userTypeSelection.regular.action')}</span>
            </div>
          </button>

          {/* Experienced User Card - Right Side */}
          <button 
            className="user-card experienced-user"
            onClick={() => onSelectUserType('experienced')}
          >
            <div className="card-icon">
              <Sparkles size={64} />
            </div>
            <h2>{t('userTypeSelection.experienced.title')}</h2>
            <p className="card-description">
              {t('userTypeSelection.experienced.description')}
            </p>
            <ul className="card-features">
              <li>{t('userTypeSelection.experienced.feature1')}</li>
              <li>{t('userTypeSelection.experienced.feature2')}</li>
              <li>{t('userTypeSelection.experienced.feature3')}</li>
            </ul>
            <div className="card-action">
              <span className="action-text">{t('userTypeSelection.experienced.action')}</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

export default UserTypeSelection;