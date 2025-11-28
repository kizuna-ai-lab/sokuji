import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useSession } from './lib/auth-client';

// Auth pages
import { SignIn } from './pages/auth/SignIn';
import { SignUp } from './pages/auth/SignUp';
import { ForgotPassword } from './pages/auth/ForgotPassword';
import { ResetPassword } from './pages/auth/ResetPassword';
import { VerifyToken } from './pages/auth/VerifyToken';

// Dashboard pages
import { DashboardLayout } from './components/layout/DashboardLayout';
import { Dashboard } from './pages/dashboard/Dashboard';
import { Profile } from './pages/dashboard/Profile';
import { Security } from './pages/dashboard/Security';

// Public pages
import { LandingLayout } from './components/layout/LandingLayout';
import { DocsLayout } from './components/layout/DocsLayout';
import { Landing } from './pages/public/Landing';
import { DocsHome } from './pages/docs/DocsHome';
import { WindowsInstall } from './pages/docs/WindowsInstall';
import { LinuxInstall } from './pages/docs/LinuxInstall';
import { MacOSInstall } from './pages/docs/MacOSInstall';
import { SupportedSites } from './pages/docs/SupportedSites';
import { AIProviders } from './pages/docs/AIProviders';
import { PrivacyPolicy } from './pages/docs/PrivacyPolicy';

// Dashboard pages - Feedback
import { Feedback } from './pages/dashboard/Feedback';

// Tutorial pages - Platform tutorials
import { ZoomTutorial } from './pages/docs/tutorials/ZoomTutorial';
import { GoogleMeetTutorial } from './pages/docs/tutorials/GoogleMeetTutorial';
import { MicrosoftTeamsTutorial } from './pages/docs/tutorials/MicrosoftTeamsTutorial';
import { DiscordTutorial } from './pages/docs/tutorials/DiscordTutorial';
import { SlackTutorial } from './pages/docs/tutorials/SlackTutorial';
import { WherebyTutorial } from './pages/docs/tutorials/WherebyTutorial';
import { GatherTutorial } from './pages/docs/tutorials/GatherTutorial';

// Tutorial pages - AI Provider setups
import { OpenAISetup } from './pages/docs/tutorials/OpenAISetup';
import { GeminiSetup } from './pages/docs/tutorials/GeminiSetup';
import { PalabraAISetup } from './pages/docs/tutorials/PalabraAISetup';
import { CometAPISetup } from './pages/docs/tutorials/CometAPISetup';
import { RealtimeAPITester } from './pages/docs/tutorials/RealtimeAPITester';

// Protected route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();
  const [initialLoad, setInitialLoad] = useState(true);

  useEffect(() => {
    if (!isPending) {
      setInitialLoad(false);
    }
  }, [isPending]);

  // Only show loading on initial load, not on refetch (e.g., tab switch)
  if (isPending && initialLoad) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/sign-in" replace />;
  }

  return <>{children}</>;
}

// Public route wrapper (redirect if authenticated)
function PublicRoute({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();
  const [initialLoad, setInitialLoad] = useState(true);

  useEffect(() => {
    if (!isPending) {
      setInitialLoad(false);
    }
  }, [isPending]);

  // Only show loading on initial load, not on refetch (e.g., tab switch)
  if (isPending && initialLoad) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
      </div>
    );
  }

  if (session) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      {/* Public landing page */}
      <Route path="/" element={<LandingLayout />}>
        <Route index element={<Landing />} />
      </Route>

      {/* Public documentation routes */}
      <Route path="/docs" element={<DocsLayout />}>
        <Route index element={<DocsHome />} />
        <Route path="install/windows" element={<WindowsInstall />} />
        <Route path="install/linux" element={<LinuxInstall />} />
        <Route path="install/macos" element={<MacOSInstall />} />
        <Route path="supported-sites" element={<SupportedSites />} />
        <Route path="ai-providers" element={<AIProviders />} />
        <Route path="privacy" element={<PrivacyPolicy />} />

        {/* Platform tutorial routes */}
        <Route path="tutorials/zoom" element={<ZoomTutorial />} />
        <Route path="tutorials/google-meet" element={<GoogleMeetTutorial />} />
        <Route path="tutorials/microsoft-teams" element={<MicrosoftTeamsTutorial />} />
        <Route path="tutorials/discord" element={<DiscordTutorial />} />
        <Route path="tutorials/slack" element={<SlackTutorial />} />
        <Route path="tutorials/whereby" element={<WherebyTutorial />} />
        <Route path="tutorials/gather" element={<GatherTutorial />} />

        {/* AI Provider setup routes */}
        <Route path="tutorials/openai-setup" element={<OpenAISetup />} />
        <Route path="tutorials/gemini-setup" element={<GeminiSetup />} />
        <Route path="tutorials/palabraai-setup" element={<PalabraAISetup />} />
        <Route path="tutorials/cometapi-setup" element={<CometAPISetup />} />
        <Route path="tutorials/realtime-api-tester" element={<RealtimeAPITester />} />
      </Route>

      {/* Public auth routes */}
      <Route
        path="/sign-in"
        element={
          <PublicRoute>
            <SignIn />
          </PublicRoute>
        }
      />
      <Route
        path="/sign-up"
        element={
          <PublicRoute>
            <SignUp />
          </PublicRoute>
        }
      />
      <Route
        path="/forgot-password"
        element={
          <PublicRoute>
            <ForgotPassword />
          </PublicRoute>
        }
      />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/auth/verify" element={<VerifyToken />} />

      {/* Protected dashboard routes */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="profile" element={<Profile />} />
        <Route path="security" element={<Security />} />
        <Route path="feedback" element={<Feedback />} />
      </Route>

      {/* Fallback redirect */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
