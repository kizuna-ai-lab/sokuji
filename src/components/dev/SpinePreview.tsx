import { useMemo } from 'react';
import { useAuth } from '../../lib/auth/hooks';
import { presentProviders } from '../../providers/registry';
import { ProviderPanel } from '../providers/ProviderPanel';
import '../Settings/Settings.scss';
import './SpinePreview.scss';

/**
 * Development builds only: the new provider layer on a page of its own, so it
 * can be looked at and screenshotted before plan 1e moves it into the
 * settings panel. Open the dev server at `/?preview=spine`.
 */
export function SpinePreview() {
  const { isSignedIn, getToken } = useAuth();
  const auth = useMemo(() => ({ signedIn: isSignedIn, getToken }), [isSignedIn, getToken]);
  const providers = useMemo(() => presentProviders(), []);
  return (
    <div className="settings-container spine-preview">
      <div className="settings-body">
        <ProviderPanel providers={providers} auth={auth} />
      </div>
    </div>
  );
}
