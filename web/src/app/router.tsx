/**
 * Minimal typed router over the History API. Paths: /login, /signup, /app/*.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';

export type Route =
  | { name: 'login' }
  | { name: 'signup' }
  | { name: 'overview' }
  | { name: 'applications' }
  | { name: 'application'; id: string }
  | { name: 'knowledge' }
  | { name: 'source'; id: string }
  | { name: 'guidance'; tab: GuidanceTab }
  | { name: 'workflow'; id: string }
  | { name: 'privacy' }
  | { name: 'analytics' }
  | { name: 'settings' }
  | { name: 'notFound'; path: string };

export type GuidanceTab = 'workflows' | 'knowledge' | 'mappings' | 'preview';
const GUIDANCE_TABS: GuidanceTab[] = ['workflows', 'knowledge', 'mappings', 'preview'];

export function parseRoute(pathname: string, search: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/';
  const parts = path.split('/').filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  if (path === '/login') return { name: 'login' };
  if (path === '/signup') return { name: 'signup' };
  if (parts[0] !== 'app') return { name: 'notFound', path };
  const [, a, b, c] = parts;
  if (!a) return { name: 'overview' };
  if (a === 'applications') return b ? { name: 'application', id: b } : { name: 'applications' };
  if (a === 'knowledge') return b ? { name: 'source', id: b } : { name: 'knowledge' };
  if (a === 'guidance') {
    if (b === 'workflows' && c) return { name: 'workflow', id: c };
    const tab = new URLSearchParams(search).get('tab');
    return { name: 'guidance', tab: GUIDANCE_TABS.includes(tab as GuidanceTab) ? (tab as GuidanceTab) : 'workflows' };
  }
  if (a === 'privacy') return { name: 'privacy' };
  if (a === 'analytics') return { name: 'analytics' };
  if (a === 'settings') return { name: 'settings' };
  return { name: 'notFound', path };
}

export const paths = {
  overview: () => '/app',
  applications: () => '/app/applications',
  application: (id: string) => `/app/applications/${encodeURIComponent(id)}`,
  knowledge: () => '/app/knowledge',
  source: (id: string) => `/app/knowledge/${encodeURIComponent(id)}`,
  guidance: (tab: GuidanceTab = 'workflows') => (tab === 'workflows' ? '/app/guidance' : `/app/guidance?tab=${tab}`),
  workflow: (id: string) => `/app/guidance/workflows/${encodeURIComponent(id)}`,
  privacy: () => '/app/privacy',
  analytics: () => '/app/analytics',
  settings: () => '/app/settings',
  login: () => '/login',
  signup: () => '/signup',
};

interface RouterValue {
  route: Route;
  location: { pathname: string; search: string };
  navigate: (to: string, opts?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

function readLocation() {
  return { pathname: window.location.pathname, search: window.location.search };
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(readLocation);

  useEffect(() => {
    const onPop = () => setLocation(readLocation());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    const url = new URL(to, window.location.origin);
    if (url.origin !== window.location.origin) {
      window.location.assign(to);
      return;
    }
    const target = url.pathname + url.search + url.hash;
    if (target === window.location.pathname + window.location.search + window.location.hash) return;
    if (opts?.replace) window.history.replaceState(null, '', target);
    else window.history.pushState(null, '', target);
    setLocation(readLocation());
    if (!opts?.replace) window.scrollTo(0, 0);
  }, []);

  const value = useMemo<RouterValue>(
    () => ({ route: parseRoute(location.pathname, location.search), location, navigate }),
    [location, navigate],
  );
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter must be used inside <RouterProvider>');
  return ctx;
}

/** Client-side link; falls through to the browser for modified clicks / new tabs. */
export function Link({ href, onClick, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const { navigate } = useRouter();
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (rest.target && rest.target !== '_self') return;
    if (!href.startsWith('/')) return;
    e.preventDefault();
    navigate(href);
  };
  return (
    <a href={href} onClick={handle} {...rest}>
      {children}
    </a>
  );
}
