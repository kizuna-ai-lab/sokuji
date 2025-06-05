import React, { useState, useEffect } from 'react';
import { AnalyticsConsent } from '../lib/analytics';
import './AnalyticsConsent.scss';

interface AnalyticsConsentBannerProps {
  onConsentChange?: (hasConsent: boolean) => void;
}

export const AnalyticsConsentBanner: React.FC<AnalyticsConsentBannerProps> = ({ 
  onConsentChange 
}) => {
  const [showBanner, setShowBanner] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Show banner if consent is required
    if (AnalyticsConsent.isConsentRequired()) {
      setShowBanner(true);
      // Delay visibility for animation
      setTimeout(() => setIsVisible(true), 100);
    }
  }, []);

  const handleAccept = () => {
    AnalyticsConsent.grantConsent();
    setIsVisible(false);
    setTimeout(() => {
      setShowBanner(false);
      onConsentChange?.(true);
    }, 300);
  };

  const handleDecline = () => {
    AnalyticsConsent.revokeConsent();
    setIsVisible(false);
    setTimeout(() => {
      setShowBanner(false);
      onConsentChange?.(false);
    }, 300);
  };

  if (!showBanner) return null;

  return (
    <div className={`analytics-consent-banner ${isVisible ? 'visible' : ''}`}>
      <div className="consent-content">
        <div className="consent-text">
          <h3>Help us improve Sokuji</h3>
          <p>
            We use analytics to understand how you use Sokuji and improve your experience. 
            We respect your privacy and never collect audio content or personal translations.
          </p>
          <details className="privacy-details">
            <summary>What data do we collect?</summary>
            <ul>
              <li>App usage patterns and feature interactions</li>
              <li>Performance metrics and error reports</li>
              <li>Language preferences and settings</li>
              <li>Device type and platform information</li>
            </ul>
            <p>
              <strong>We never collect:</strong> Audio recordings, translation content, 
              personal information, or any sensitive data.
            </p>
          </details>
        </div>
        <div className="consent-actions">
          <button 
            className="btn-decline" 
            onClick={handleDecline}
            aria-label="Decline analytics tracking"
          >
            No, thanks
          </button>
          <button 
            className="btn-accept" 
            onClick={handleAccept}
            aria-label="Accept analytics tracking"
          >
            Accept & Continue
          </button>
        </div>
      </div>
    </div>
  );
};

// Settings component for managing consent after initial setup
export const AnalyticsSettings: React.FC = () => {
  const [hasConsent, setHasConsent] = useState(AnalyticsConsent.hasConsent());

  const handleToggleConsent = () => {
    if (hasConsent) {
      AnalyticsConsent.revokeConsent();
      setHasConsent(false);
      // Reload to reinitialize PostHog without tracking
      window.location.reload();
    } else {
      AnalyticsConsent.grantConsent();
      setHasConsent(true);
      // Reload to reinitialize PostHog with tracking
      window.location.reload();
    }
  };

  return (
    <div className="analytics-settings">
      <div className="setting-item">
        <div className="setting-info">
          <h4>Analytics & Usage Data</h4>
          <p>
            Help improve Sokuji by sharing anonymous usage data. 
            No audio content or personal translations are ever collected.
          </p>
        </div>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={hasConsent}
            onChange={handleToggleConsent}
            aria-label="Toggle analytics tracking"
          />
          <span className="slider"></span>
        </label>
      </div>
    </div>
  );
}; 