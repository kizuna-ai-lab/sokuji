import { useState, useEffect, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/lib/auth-client';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { MessageCircle, Bug, Lightbulb, HelpCircle, AlertTriangle } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import './Feedback.scss';

type FeedbackType = 'bug' | 'suggestion' | 'other';

export function Feedback() {
  const { data: session } = useSession();
  const { t } = useI18n();
  const user = session?.user;
  const isEmailVerified = user?.emailVerified;

  const [type, setType] = useState<FeedbackType>('bug');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  const [dailyLimit, setDailyLimit] = useState<number>(3);

  // Fetch remaining feedback count
  useEffect(() => {
    if (isEmailVerified) {
      fetch('/api/feedback/remaining')
        .then((res) => res.json())
        .then((data) => {
          if (data.remaining !== undefined) {
            setRemaining(data.remaining);
            setDailyLimit(data.limit);
          }
        })
        .catch(console.error);
    }
  }, [isEmailVerified]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type,
          message,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to send feedback');
        if (data.remaining !== undefined) {
          setRemaining(data.remaining);
        }
        setLoading(false);
        return;
      }

      setSuccess(t('dashboard.feedback.thankYou'));
      setMessage('');
      if (data.remaining !== undefined) {
        setRemaining(data.remaining);
      }
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const feedbackTypes: { value: FeedbackType; labelKey: string; icon: typeof Bug; descKey: string }[] = [
    { value: 'bug', labelKey: 'dashboard.feedback.bugReport', icon: Bug, descKey: 'dashboard.feedback.bugReportDesc' },
    { value: 'suggestion', labelKey: 'dashboard.feedback.suggestion', icon: Lightbulb, descKey: 'dashboard.feedback.suggestionDesc' },
    { value: 'other', labelKey: 'dashboard.feedback.other', icon: HelpCircle, descKey: 'dashboard.feedback.otherDesc' },
  ];

  // Show verification required message if email is not verified
  if (!isEmailVerified) {
    return (
      <div className="feedback-page">
        <div className="feedback-page__header">
          <h1>{t('dashboard.feedback.title')}</h1>
          <p>{t('dashboard.feedback.subtitle')}</p>
        </div>

        <div className="feedback-page__content">
          <div className="feedback-section">
            <div className="feedback-section__verification-required">
              <AlertTriangle size={48} />
              <h2>{t('dashboard.feedback.verificationRequired')}</h2>
              <p>{t('dashboard.feedback.verificationRequiredDesc')}</p>
              <Link to="/dashboard/profile">
                <Button>{t('dashboard.feedback.goToProfile')}</Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="feedback-page">
      <div className="feedback-page__header">
        <h1>{t('dashboard.feedback.title')}</h1>
        <p>{t('dashboard.feedback.subtitle')}</p>
      </div>

      <div className="feedback-page__content">
        <div className="feedback-section">
          <div className="feedback-section__header">
            <MessageCircle size={20} />
            <div>
              <h2>{t('dashboard.feedback.yourFeedback')}</h2>
              <p>{t('dashboard.feedback.sendingAs').replace('{email}', user?.email || '')}</p>
            </div>
          </div>

          {remaining !== null && (
            <div className={`feedback-section__remaining ${remaining === 0 ? 'feedback-section__remaining--exhausted' : ''}`}>
              {remaining > 0 ? (
                <span>{t('dashboard.feedback.remainingCount').replace('{remaining}', String(remaining)).replace('{limit}', String(dailyLimit))}</span>
              ) : (
                <span>{t('dashboard.feedback.limitReached')}</span>
              )}
            </div>
          )}

          <form className="feedback-section__form" onSubmit={handleSubmit}>
            {error && <Alert variant="error">{error}</Alert>}
            {success && <Alert variant="success">{success}</Alert>}

            <div className="feedback-form__field">
              <label className="feedback-form__label">{t('dashboard.feedback.feedbackType')}</label>
              <div className="feedback-form__types">
                {feedbackTypes.map(({ value, labelKey, icon: Icon, descKey }) => (
                  <button
                    key={value}
                    type="button"
                    className={`feedback-type ${type === value ? 'feedback-type--active' : ''}`}
                    onClick={() => setType(value)}
                    disabled={loading}
                  >
                    <Icon size={20} />
                    <div className="feedback-type__content">
                      <span className="feedback-type__label">{t(labelKey)}</span>
                      <span className="feedback-type__description">{t(descKey)}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="feedback-form__field">
              <label htmlFor="message" className="feedback-form__label">
                {t('dashboard.feedback.message')}
              </label>
              <textarea
                id="message"
                className="feedback-form__textarea"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t('dashboard.feedback.messagePlaceholder')}
                disabled={loading}
                rows={6}
                required
                minLength={10}
                maxLength={5000}
              />
              <span className="feedback-form__hint">
                {t('dashboard.feedback.messageHint').replace('{count}', String(message.length))}
              </span>
            </div>

            <div className="feedback-form__actions">
              <Button type="submit" loading={loading} disabled={message.length < 10 || remaining === 0}>
                {t('dashboard.feedback.sendFeedback')}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
