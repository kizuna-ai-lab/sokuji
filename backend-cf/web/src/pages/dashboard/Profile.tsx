import { useState, useEffect, FormEvent } from 'react';
import { useSession, authClient } from '@/lib/auth-client';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { User, Mail, Check } from 'lucide-react';
import { useAnalytics } from '@/lib/analytics';
import './Profile.scss';

export function Profile() {
  const { data: session, refetch } = useSession();
  const { trackEvent } = useAnalytics();
  const user = session?.user;

  // Track page view on mount
  useEffect(() => {
    trackEvent('dashboard_page_viewed', { page: 'profile' });
  }, []);

  // Profile form state
  const [name, setName] = useState(user?.name || '');
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');

  // Email change state
  const [newEmail, setNewEmail] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [emailSuccess, setEmailSuccess] = useState('');

  // Verification state
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState('');

  const handleProfileUpdate = async (e: FormEvent) => {
    e.preventDefault();
    setProfileError('');
    setProfileSuccess('');
    setProfileLoading(true);

    try {
      const { error } = await authClient.updateUser({
        name,
      });

      if (error) {
        setProfileError(error.message || 'Failed to update profile');
        setProfileLoading(false);
        return;
      }

      // Track profile update
      trackEvent('dashboard_profile_updated', { fields_updated: ['name'] });
      setProfileSuccess('Profile updated successfully');
      await refetch();
    } catch {
      setProfileError('An unexpected error occurred');
    } finally {
      setProfileLoading(false);
    }
  };

  const handleEmailChange = async (e: FormEvent) => {
    e.preventDefault();
    setEmailError('');
    setEmailSuccess('');
    setEmailLoading(true);

    try {
      const { error } = await authClient.changeEmail({
        newEmail,
        callbackURL: `${window.location.origin}/dashboard/profile`,
      });

      if (error) {
        setEmailError(error.message || 'Failed to change email');
        setEmailLoading(false);
        return;
      }

      // Track email change request
      trackEvent('dashboard_email_changed', {});
      setEmailSuccess('Verification email sent to your new address. Please check your inbox.');
      setNewEmail('');
    } catch {
      setEmailError('An unexpected error occurred');
    } finally {
      setEmailLoading(false);
    }
  };

  const handleResendVerification = async () => {
    setVerificationMessage('');
    setVerificationLoading(true);

    try {
      const { error } = await authClient.sendVerificationEmail({
        email: user?.email || '',
        callbackURL: `${window.location.origin}/dashboard`,
      });

      if (error) {
        setVerificationMessage('Failed to send verification email');
        setVerificationLoading(false);
        return;
      }

      setVerificationMessage('Verification email sent! Check your inbox.');
    } catch {
      setVerificationMessage('An unexpected error occurred');
    } finally {
      setVerificationLoading(false);
    }
  };

  return (
    <div className="profile-page">
      <div className="profile-page__header">
        <h1>Profile Settings</h1>
        <p>Manage your personal information</p>
      </div>

      <div className="profile-page__content">
        {/* Profile Information */}
        <section className="profile-section">
          <div className="profile-section__header">
            <User size={20} />
            <div>
              <h2>Personal Information</h2>
              <p>Update your name and basic information</p>
            </div>
          </div>

          <form className="profile-section__form" onSubmit={handleProfileUpdate}>
            {profileError && <Alert variant="error">{profileError}</Alert>}
            {profileSuccess && <Alert variant="success">{profileSuccess}</Alert>}

            <Input
              label="Name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              disabled={profileLoading}
            />

            <div className="profile-section__actions">
              <Button type="submit" loading={profileLoading}>
                Save Changes
              </Button>
            </div>
          </form>
        </section>

        {/* Email Settings */}
        <section className="profile-section">
          <div className="profile-section__header">
            <Mail size={20} />
            <div>
              <h2>Email Address</h2>
              <p>Manage your email address and verification status</p>
            </div>
          </div>

          <div className="profile-section__content">
            <div className="profile-section__current-email">
              <div className="profile-section__email-info">
                <span className="profile-section__label">Current Email</span>
                <span className="profile-section__value">{user?.email}</span>
              </div>
              <div className="profile-section__email-status">
                {user?.emailVerified ? (
                  <span className="profile-section__badge profile-section__badge--success">
                    <Check size={14} />
                    Verified
                  </span>
                ) : (
                  <div className="profile-section__unverified">
                    <span className="profile-section__badge profile-section__badge--warning">
                      Not Verified
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleResendVerification}
                      loading={verificationLoading}
                    >
                      Resend Verification
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {verificationMessage && (
              <Alert variant="info">{verificationMessage}</Alert>
            )}
          </div>

          <div className="profile-section__divider" />

          <form className="profile-section__form" onSubmit={handleEmailChange}>
            <h3>Change Email Address</h3>

            {emailError && <Alert variant="error">{emailError}</Alert>}
            {emailSuccess && <Alert variant="success">{emailSuccess}</Alert>}

            <Input
              label="New Email Address"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="new@email.com"
              disabled={emailLoading}
              hint="A verification email will be sent to the new address"
            />

            <div className="profile-section__actions">
              <Button type="submit" loading={emailLoading} disabled={!newEmail}>
                Change Email
              </Button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
