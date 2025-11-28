import React, { useState, FormEvent, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import Modal from '../Modal/Modal';
import { useSession } from '../../lib/auth-client';
import { Bug, Lightbulb, HelpCircle, Loader2, AlertTriangle } from 'lucide-react';
import './FeedbackModal.scss';

type FeedbackType = 'bug' | 'suggestion' | 'other';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const FEEDBACK_API_URL = import.meta.env.VITE_API_URL || 'https://sokuji.kizuna.ai';

const FeedbackModal: React.FC<FeedbackModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: session } = useSession();
  const user = session?.user;
  const userEmail = user?.email || '';
  const isEmailVerified = user?.emailVerified;
  const isSignedIn = !!session;

  const [email, setEmail] = useState('');
  const [type, setType] = useState<FeedbackType>('bug');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [dailyLimit, setDailyLimit] = useState<number>(3);

  // Update email when user session loads
  useEffect(() => {
    if (userEmail && !email) {
      setEmail(userEmail);
    }
  }, [userEmail, email]);

  // Fetch remaining feedback count when modal opens
  useEffect(() => {
    if (isOpen && isSignedIn && isEmailVerified) {
      fetch(`${FEEDBACK_API_URL}/api/feedback/remaining`, {
        credentials: 'include',
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.remaining !== undefined) {
            setRemaining(data.remaining);
            setDailyLimit(data.limit);
          }
        })
        .catch(console.error);
    }
  }, [isOpen, isSignedIn, isEmailVerified]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${FEEDBACK_API_URL}/api/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          type,
          message,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || t('feedback.error'));
        if (data.remaining !== undefined) {
          setRemaining(data.remaining);
        }
        setLoading(false);
        return;
      }

      setSuccess(true);
      setMessage('');
      if (data.remaining !== undefined) {
        setRemaining(data.remaining);
      }
    } catch {
      setError(t('feedback.error'));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setError('');
    setSuccess(false);
    setMessage('');
    if (!userEmail) {
      setEmail('');
    }
    onClose();
  };

  const handleSignIn = () => {
    handleClose();
    navigate('/sign-in');
  };

  const feedbackTypes: { value: FeedbackType; labelKey: string; icon: typeof Bug }[] = [
    { value: 'bug', labelKey: 'feedback.typeBug', icon: Bug },
    { value: 'suggestion', labelKey: 'feedback.typeSuggestion', icon: Lightbulb },
    { value: 'other', labelKey: 'feedback.typeOther', icon: HelpCircle },
  ];

  // Show sign-in required message
  if (!isSignedIn) {
    return (
      <Modal isOpen={isOpen} onClose={handleClose} title={t('feedback.title')}>
        <div className="feedback-modal">
          <div className="feedback-modal__verification-required">
            <AlertTriangle size={40} />
            <h3>{t('feedback.signInRequired', 'Sign In Required')}</h3>
            <p>{t('feedback.signInRequiredDesc', 'Please sign in to submit feedback. We need your account to respond to your feedback.')}</p>
            <button className="feedback-modal__submit-btn" onClick={handleSignIn}>
              {t('common.signIn', 'Sign In')}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  // Show verification required message
  if (!isEmailVerified) {
    return (
      <Modal isOpen={isOpen} onClose={handleClose} title={t('feedback.title')}>
        <div className="feedback-modal">
          <div className="feedback-modal__verification-required">
            <AlertTriangle size={40} />
            <h3>{t('feedback.verificationRequired', 'Email Verification Required')}</h3>
            <p>{t('feedback.verificationRequiredDesc', 'Please verify your email address before submitting feedback. We need a verified email to respond to your feedback.')}</p>
            <button className="feedback-modal__close-btn" onClick={handleClose}>
              {t('common.close', 'Close')}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t('feedback.title')}>
      <div className="feedback-modal">
        <p className="feedback-modal__description">{t('feedback.description')}</p>
        <p className="feedback-modal__sending-as">
          {t('feedback.sendingAs', 'Sending as')}: <strong>{userEmail}</strong>
        </p>

        {remaining !== null && (
          <div className={`feedback-modal__remaining ${remaining === 0 ? 'feedback-modal__remaining--exhausted' : ''}`}>
            {remaining > 0 ? (
              t('feedback.remainingCount', 'You have {{remaining}} of {{limit}} feedback messages remaining today', { remaining, limit: dailyLimit })
            ) : (
              t('feedback.limitReached', 'Daily limit reached. You can send more feedback tomorrow.')
            )}
          </div>
        )}

        {success ? (
          <div className="feedback-modal__success">
            <div className="feedback-modal__success-icon">✓</div>
            <p>{t('feedback.success')}</p>
            <button className="feedback-modal__close-btn" onClick={handleClose}>
              {t('common.close')}
            </button>
          </div>
        ) : (
          <form className="feedback-modal__form" onSubmit={handleSubmit}>
            {error && <div className="feedback-modal__error">{error}</div>}

            <div className="feedback-modal__field">
              <label>{t('feedback.type')}</label>
              <div className="feedback-modal__types">
                {feedbackTypes.map(({ value, labelKey, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    className={`feedback-type-btn ${type === value ? 'feedback-type-btn--active' : ''}`}
                    onClick={() => setType(value)}
                    disabled={loading}
                  >
                    <Icon size={16} />
                    <span>{t(labelKey)}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="feedback-modal__field">
              <label htmlFor="feedback-message">{t('feedback.message')}</label>
              <textarea
                id="feedback-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t('feedback.messagePlaceholder')}
                disabled={loading}
                rows={5}
                required
                minLength={10}
                maxLength={5000}
              />
              <span className="feedback-modal__hint">
                {message.length}/5000
              </span>
            </div>

            <div className="feedback-modal__actions">
              <button
                type="button"
                className="feedback-modal__cancel-btn"
                onClick={handleClose}
                disabled={loading}
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                className="feedback-modal__submit-btn"
                disabled={loading || message.length < 10 || remaining === 0}
              >
                {loading ? (
                  <>
                    <Loader2 size={16} className="spinning" />
                    {t('feedback.submitting')}
                  </>
                ) : (
                  t('feedback.submit')
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
};

export default FeedbackModal;
