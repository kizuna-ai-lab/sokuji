import { useState, useEffect, FormEvent } from 'react';
import { useSession, authClient, signOut } from '@/lib/auth-client';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Shield, Key, Trash2, AlertTriangle, Monitor, Smartphone, Globe, X } from 'lucide-react';
import { useAnalytics } from '@/lib/analytics';
import './Security.scss';

interface Session {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  ipAddress?: string;
  userAgent?: string;
  city?: string;
  country?: string;
}

export function Security() {
  const navigate = useNavigate();
  const { data: session, refetch } = useSession();
  const { trackEvent, resetUser } = useAnalytics();
  const user = session?.user;
  const currentSessionToken = session?.session?.token;

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  // Delete account state
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Sessions state
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState('');
  const [revokeLoading, setRevokeLoading] = useState<string | null>(null);

  // Track page view on mount
  useEffect(() => {
    trackEvent('dashboard_page_viewed', { page: 'security' });
  }, []);

  // Fetch all sessions
  const fetchSessions = async () => {
    setSessionsLoading(true);
    setSessionsError('');
    try {
      const { data, error } = await authClient.listSessions();
      if (error) {
        setSessionsError(error.message || 'Failed to load sessions');
      } else if (data) {
        setSessions(data as Session[]);
      }
    } catch {
      setSessionsError('Failed to load sessions');
    } finally {
      setSessionsLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  // Revoke a specific session
  const handleRevokeSession = async (sessionToken: string) => {
    setRevokeLoading(sessionToken);
    try {
      const { error } = await authClient.revokeSession({ token: sessionToken });
      if (error) {
        setSessionsError(error.message || 'Failed to revoke session');
      } else {
        // Track session revocation
        trackEvent('dashboard_session_revoked', { session_id: sessionToken });
        await fetchSessions();
      }
    } catch {
      setSessionsError('Failed to revoke session');
    } finally {
      setRevokeLoading(null);
    }
  };

  // Revoke all other sessions
  const handleRevokeOtherSessions = async () => {
    setRevokeLoading('all');
    try {
      const { error } = await authClient.revokeOtherSessions();
      if (error) {
        setSessionsError(error.message || 'Failed to revoke other sessions');
      } else {
        // Track all sessions revoked
        trackEvent('dashboard_all_sessions_revoked', {});
        await fetchSessions();
      }
    } catch {
      setSessionsError('Failed to revoke other sessions');
    } finally {
      setRevokeLoading(null);
    }
  };

  // Parse user agent to get device info
  const getDeviceInfo = (userAgent?: string) => {
    if (!userAgent) return { type: 'unknown', name: 'Unknown Device' };

    // Check for Sokuji Electron app first (custom UA format: "Sokuji/x.x.x Electron/x.x.x (platform)")
    const sokujiMatch = userAgent.match(/Sokuji\/([\d.]+)\s+Electron\/([\d.]+)\s+\((\w+)\)/);
    if (sokujiMatch) {
      const [, appVersion, , platform] = sokujiMatch;
      let os = 'Unknown OS';
      if (platform === 'linux') os = 'Linux';
      else if (platform === 'darwin') os = 'macOS';
      else if (platform === 'win32') os = 'Windows';
      return {
        type: 'desktop',
        name: `Sokuji App v${appVersion} on ${os}`,
      };
    }

    const isMobile = /Mobile|Android|iPhone|iPad/i.test(userAgent);
    const isTablet = /iPad|Tablet/i.test(userAgent);

    let browser = 'Unknown Browser';
    if (userAgent.includes('Electron')) browser = 'Electron';
    else if (userAgent.includes('Chrome')) browser = 'Chrome';
    else if (userAgent.includes('Firefox')) browser = 'Firefox';
    else if (userAgent.includes('Safari')) browser = 'Safari';
    else if (userAgent.includes('Edge')) browser = 'Edge';

    let os = 'Unknown OS';
    if (userAgent.includes('Windows')) os = 'Windows';
    else if (userAgent.includes('Mac')) os = 'macOS';
    else if (userAgent.includes('Linux')) os = 'Linux';
    else if (userAgent.includes('Android')) os = 'Android';
    else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) os = 'iOS';

    return {
      type: isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop',
      name: `${browser} on ${os}`,
    };
  };

  // Format date
  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handlePasswordChange = async (e: FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    // Validation
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }

    setPasswordLoading(true);

    try {
      const { error } = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });

      if (error) {
        if (error.code === 'INVALID_PASSWORD' || error.status === 400) {
          setPasswordError('Current password is incorrect');
        } else {
          setPasswordError(error.message || 'Failed to change password');
        }
        setPasswordLoading(false);
        return;
      }

      // Track password change
      trackEvent('dashboard_password_changed', {});
      setPasswordSuccess('Password changed successfully. Other sessions have been logged out.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await refetch();
    } catch {
      setPasswordError('An unexpected error occurred');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleDeleteAccount = async (e: FormEvent) => {
    e.preventDefault();
    setDeleteError('');

    if (deleteConfirm !== 'DELETE') {
      setDeleteError('Please type DELETE to confirm');
      return;
    }

    setDeleteLoading(true);

    try {
      const { error } = await authClient.deleteUser();

      if (error) {
        setDeleteError(error.message || 'Failed to delete account');
        setDeleteLoading(false);
        return;
      }

      // Track account deletion and reset user identity
      trackEvent('dashboard_account_deleted', {});
      resetUser();

      // Sign out and redirect
      await signOut();
      navigate('/sign-in', { replace: true });
    } catch {
      setDeleteError('An unexpected error occurred');
      setDeleteLoading(false);
    }
  };

  const isAnonymous = (user as { isAnonymous?: boolean })?.isAnonymous;

  return (
    <div className="security-page">
      <div className="security-page__header">
        <h1>Security Settings</h1>
        <p>Manage your password and account security</p>
      </div>

      <div className="security-page__content">
        {/* Password Change */}
        <section className="security-section">
          <div className="security-section__header">
            <Key size={20} />
            <div>
              <h2>Change Password</h2>
              <p>Update your password to keep your account secure</p>
            </div>
          </div>

          {isAnonymous ? (
            <div className="security-section__content">
              <Alert variant="info">
                Anonymous accounts cannot change passwords. Please convert to a full account first.
              </Alert>
            </div>
          ) : (
            <form className="security-section__form" onSubmit={handlePasswordChange}>
              {passwordError && <Alert variant="error">{passwordError}</Alert>}
              {passwordSuccess && <Alert variant="success">{passwordSuccess}</Alert>}

              <Input
                label="Current Password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                disabled={passwordLoading}
                required
              />

              <Input
                label="New Password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                disabled={passwordLoading}
                required
              />

              <Input
                label="Confirm New Password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                disabled={passwordLoading}
                required
              />

              <div className="security-section__actions">
                <Button type="submit" loading={passwordLoading}>
                  Change Password
                </Button>
              </div>
            </form>
          )}
        </section>

        {/* Account Sessions */}
        <section className="security-section">
          <div className="security-section__header">
            <Shield size={20} />
            <div>
              <h2>Active Sessions</h2>
              <p>Manage your active login sessions ({sessions.length} active)</p>
            </div>
          </div>

          <div className="security-section__content">
            {sessionsError && <Alert variant="error">{sessionsError}</Alert>}

            {sessionsLoading ? (
              <div className="security-section__loading">Loading sessions...</div>
            ) : (
              <div className="security-section__sessions-list">
                {sessions.map((s) => {
                  const isCurrentSession = s.token === currentSessionToken;
                  const deviceInfo = getDeviceInfo(s.userAgent);
                  const DeviceIcon = deviceInfo.type === 'mobile' ? Smartphone : Monitor;

                  return (
                    <div
                      key={s.id}
                      className={`security-section__session ${isCurrentSession ? 'security-section__session--current' : ''}`}
                    >
                      <div className="security-section__session-icon">
                        <DeviceIcon size={20} />
                      </div>
                      <div className="security-section__session-info">
                        <div className="security-section__session-device">
                          {deviceInfo.name}
                          {isCurrentSession && (
                            <span className="security-section__badge security-section__badge--success">
                              Current
                            </span>
                          )}
                        </div>
                        <div className="security-section__session-details">
                          {s.city && s.country && (
                            <span>
                              <Globe size={12} /> {s.city}, {s.country}
                            </span>
                          )}
                          {s.ipAddress && <span>IP: {s.ipAddress}</span>}
                          <span>Last active: {formatDate(s.updatedAt)}</span>
                        </div>
                      </div>
                      {!isCurrentSession && (
                        <button
                          className="security-section__session-revoke"
                          onClick={() => handleRevokeSession(s.token)}
                          disabled={revokeLoading === s.token}
                          title="Sign out this session"
                        >
                          {revokeLoading === s.token ? (
                            <span className="security-section__spinner" />
                          ) : (
                            <X size={16} />
                          )}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {sessions.length > 1 && (
              <Button
                variant="secondary"
                onClick={handleRevokeOtherSessions}
                loading={revokeLoading === 'all'}
                disabled={revokeLoading !== null}
              >
                Sign Out All Other Sessions
              </Button>
            )}
          </div>
        </section>

        {/* Delete Account */}
        <section className="security-section security-section--danger">
          <div className="security-section__header">
            <Trash2 size={20} />
            <div>
              <h2>Delete Account</h2>
              <p>Permanently delete your account and all associated data</p>
            </div>
          </div>

          <div className="security-section__content">
            {!showDeleteConfirm ? (
              <>
                <Alert variant="warning">
                  <AlertTriangle size={16} style={{ marginRight: '8px' }} />
                  This action is irreversible. All your data will be permanently deleted.
                </Alert>

                <Button
                  variant="danger"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  Delete My Account
                </Button>
              </>
            ) : (
              <form className="security-section__delete-form" onSubmit={handleDeleteAccount}>
                {deleteError && <Alert variant="error">{deleteError}</Alert>}

                <p className="security-section__warning-text">
                  To confirm deletion, please type <strong>DELETE</strong> below:
                </p>

                <Input
                  type="text"
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  placeholder="Type DELETE to confirm"
                  disabled={deleteLoading}
                />

                <div className="security-section__delete-actions">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setShowDeleteConfirm(false);
                      setDeleteConfirm('');
                      setDeleteError('');
                    }}
                    disabled={deleteLoading}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="danger"
                    loading={deleteLoading}
                    disabled={deleteConfirm !== 'DELETE'}
                  >
                    Delete Account
                  </Button>
                </div>
              </form>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
