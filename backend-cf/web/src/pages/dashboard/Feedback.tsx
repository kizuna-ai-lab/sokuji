import { useState, useEffect, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/lib/auth-client';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { MessageCircle, Bug, Lightbulb, HelpCircle, AlertTriangle } from 'lucide-react';
import './Feedback.scss';

type FeedbackType = 'bug' | 'suggestion' | 'other';

export function Feedback() {
  const { data: session } = useSession();
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

      setSuccess('Thank you! Your feedback has been sent successfully.');
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

  const feedbackTypes: { value: FeedbackType; label: string; icon: typeof Bug; description: string }[] = [
    { value: 'bug', label: 'Bug Report', icon: Bug, description: 'Report a problem or issue' },
    { value: 'suggestion', label: 'Feature Suggestion', icon: Lightbulb, description: 'Suggest a new feature or improvement' },
    { value: 'other', label: 'Other', icon: HelpCircle, description: 'General feedback or questions' },
  ];

  // Show verification required message if email is not verified
  if (!isEmailVerified) {
    return (
      <div className="feedback-page">
        <div className="feedback-page__header">
          <h1>Send Feedback</h1>
          <p>
            Report bugs, suggest features, or share your thoughts.
            We read every message and appreciate your input!
          </p>
        </div>

        <div className="feedback-page__content">
          <div className="feedback-section">
            <div className="feedback-section__verification-required">
              <AlertTriangle size={48} />
              <h2>Email Verification Required</h2>
              <p>
                Please verify your email address before submitting feedback.
                We need a verified email to respond to your feedback.
              </p>
              <Link to="/dashboard/profile">
                <Button>Go to Profile Settings</Button>
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
        <h1>Send Feedback</h1>
        <p>
          Report bugs, suggest features, or share your thoughts.
          We read every message and appreciate your input!
        </p>
      </div>

      <div className="feedback-page__content">
        <div className="feedback-section">
          <div className="feedback-section__header">
            <MessageCircle size={20} />
            <div>
              <h2>Your Feedback</h2>
              <p>Sending as {user?.email}</p>
            </div>
          </div>

          {remaining !== null && (
            <div className={`feedback-section__remaining ${remaining === 0 ? 'feedback-section__remaining--exhausted' : ''}`}>
              {remaining > 0 ? (
                <span>You have <strong>{remaining}</strong> of {dailyLimit} feedback messages remaining today</span>
              ) : (
                <span>Daily limit reached. You can send more feedback tomorrow.</span>
              )}
            </div>
          )}

          <form className="feedback-section__form" onSubmit={handleSubmit}>
            {error && <Alert variant="error">{error}</Alert>}
            {success && <Alert variant="success">{success}</Alert>}

            <div className="feedback-form__field">
              <label className="feedback-form__label">Feedback Type</label>
              <div className="feedback-form__types">
                {feedbackTypes.map(({ value, label, icon: Icon, description }) => (
                  <button
                    key={value}
                    type="button"
                    className={`feedback-type ${type === value ? 'feedback-type--active' : ''}`}
                    onClick={() => setType(value)}
                    disabled={loading}
                  >
                    <Icon size={20} />
                    <div className="feedback-type__content">
                      <span className="feedback-type__label">{label}</span>
                      <span className="feedback-type__description">{description}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="feedback-form__field">
              <label htmlFor="message" className="feedback-form__label">
                Message
              </label>
              <textarea
                id="message"
                className="feedback-form__textarea"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Describe your feedback in detail..."
                disabled={loading}
                rows={6}
                required
                minLength={10}
                maxLength={5000}
              />
              <span className="feedback-form__hint">
                {message.length}/5000 characters (minimum 10)
              </span>
            </div>

            <div className="feedback-form__actions">
              <Button type="submit" loading={loading} disabled={message.length < 10 || remaining === 0}>
                Send Feedback
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
