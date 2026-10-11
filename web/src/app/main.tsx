import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/components.css';
import './app.css';
import { RouterProvider, useRouter, paths } from './router.tsx';
import { SessionProvider, useSession, WorkspaceProvider } from './session.tsx';
import { RefreshProvider } from './refresh.tsx';
import { Shell } from './Shell.tsx';
import { Button, Logo, Spinner, ToastProvider } from '../ui/index.ts';
import { LoginPage, SignupPage } from './pages/Auth.tsx';
import { OverviewPage } from './pages/Overview.tsx';
import { ApplicationsPage } from './pages/Applications.tsx';
import { ApplicationDetailPage } from './pages/ApplicationDetail.tsx';
import { KnowledgePage } from './pages/Knowledge.tsx';
import { SourceDetailPage } from './pages/SourceDetail.tsx';
import { GuidancePage } from './pages/Guidance.tsx';
import { WorkflowDetailPage } from './pages/WorkflowDetail.tsx';
import { PrivacyPage } from './pages/Privacy.tsx';
import { AnalyticsPage } from './pages/Analytics.tsx';
import { SettingsPage } from './pages/Settings.tsx';
import { NotFoundPage } from './pages/NotFound.tsx';

function Redirect({ to }: { to: string }) {
  const { navigate } = useRouter();
  useEffect(() => navigate(to, { replace: true }), [navigate, to]);
  return null;
}

function FullScreenLoading() {
  return (
    <div className="boot" role="status" aria-label="Loading Navoro">
      <Logo size={28} />
      <Spinner size={18} />
    </div>
  );
}

function AuthedRoutes() {
  const { route } = useRouter();
  switch (route.name) {
    case 'overview':
      return <OverviewPage />;
    case 'applications':
      return <ApplicationsPage />;
    case 'application':
      return <ApplicationDetailPage id={route.id} />;
    case 'knowledge':
      return <KnowledgePage />;
    case 'source':
      return <SourceDetailPage id={route.id} />;
    case 'guidance':
      return <GuidancePage tab={route.tab} />;
    case 'workflow':
      return <WorkflowDetailPage id={route.id} />;
    case 'privacy':
      return <PrivacyPage />;
    case 'analytics':
      return <AnalyticsPage />;
    case 'settings':
      return <SettingsPage />;
    default:
      return <NotFoundPage />;
  }
}

function App() {
  const { route, location } = useRouter();
  const { state, retry } = useSession();

  if (state.status === 'loading') return <FullScreenLoading />;
  if (state.status === 'error') {
    return (
      <div className="boot boot--error" role="alert">
        <Logo size={28} />
        <p className="boot__title">Navoro is unreachable right now</p>
        <p className="boot__msg">{state.message}</p>
        <Button variant="primary" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  }

  const isAuthRoute = route.name === 'login' || route.name === 'signup';
  if (state.status === 'anonymous') {
    if (route.name === 'login') return <LoginPage />;
    if (route.name === 'signup') return <SignupPage />;
    const next = encodeURIComponent(location.pathname + location.search);
    return <Redirect to={`${paths.login()}?next=${next}`} />;
  }
  if (isAuthRoute) return <Redirect to={paths.overview()} />;

  return (
    <WorkspaceProvider>
      <RefreshProvider>
        <Shell>
          <AuthedRoutes />
        </Shell>
      </RefreshProvider>
    </WorkspaceProvider>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <RouterProvider>
        <SessionProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </SessionProvider>
      </RouterProvider>
    </StrictMode>,
  );
}
