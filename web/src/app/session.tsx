/**
 * Session (current user/org/role) and workspace (applications + selected app) state.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ApplicationSummary, MeResponse } from '../../../packages/contracts/src/admin-types.ts';
import { api, ApiRequestError, errorMessage, setCsrfToken } from './api.ts';

/* ───────────── Session ───────────── */

type SessionState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'error'; message: string }
  | { status: 'authenticated'; me: MeResponse };

interface SessionValue {
  state: SessionState;
  setMe: (me: MeResponse) => void;
  signOut: () => Promise<void>;
  retry: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .me(ctrl.signal)
      .then((me) => {
        setCsrfToken(me.csrfToken);
        setState({ status: 'authenticated', me });
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        if (e instanceof ApiRequestError && (e.status === 401 || e.status === 403)) setState({ status: 'anonymous' });
        else setState({ status: 'error', message: errorMessage(e) });
      });
    return () => ctrl.abort();
  }, [nonce]);

  const setMe = useCallback((me: MeResponse) => {
    setCsrfToken(me.csrfToken);
    setState({ status: 'authenticated', me });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setCsrfToken(null);
      setState({ status: 'anonymous' });
    }
  }, []);

  const value = useMemo(() => ({ state, setMe, signOut, retry: () => setNonce((n) => n + 1) }), [state, setMe, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession outside SessionProvider');
  return ctx;
}

/** Returns the authenticated MeResponse (only use inside the authenticated shell). */
export function useMe(): MeResponse {
  const { state } = useSession();
  if (state.status !== 'authenticated') throw new Error('useMe requires an authenticated session');
  return state.me;
}

/** True when the current user may change things (owners and admins). */
export function useCanEdit(): boolean {
  return useMe().role !== 'member';
}

/* ───────────── Workspace (applications + selection) ───────────── */

const STORAGE_KEY = 'navoro.selectedApplicationId';

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function writeStored(id: string | null) {
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

interface WorkspaceValue {
  applications: ApplicationSummary[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  selected: ApplicationSummary | null;
  select: (id: string) => void;
  reload: () => Promise<void>;
  /** Insert/replace an application locally after a mutation. */
  upsert: (app: ApplicationSummary) => void;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [applications, setApplications] = useState<ApplicationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(readStored);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const res = await api.applications();
      setApplications(res.applications);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Keep selection valid: fall back to the first application.
  useEffect(() => {
    if (loading) return;
    if (applications.length === 0) {
      if (selectedId !== null) {
        setSelectedId(null);
        writeStored(null);
      }
      return;
    }
    if (!selectedId || !applications.some((a) => a.id === selectedId)) {
      const first = applications[0]!.id;
      setSelectedId(first);
      writeStored(first);
    }
  }, [applications, loading, selectedId]);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    writeStored(id);
  }, []);

  const upsert = useCallback((app: ApplicationSummary) => {
    setApplications((all) => {
      const idx = all.findIndex((a) => a.id === app.id);
      const summary: ApplicationSummary = {
        id: app.id,
        name: app.name,
        publicKey: app.publicKey,
        createdAt: app.createdAt,
        lastSeenAt: app.lastSeenAt,
        sdkVersion: app.sdkVersion,
        environments: app.environments,
      };
      if (idx === -1) return [...all, summary];
      const next = all.slice();
      next[idx] = summary;
      return next;
    });
  }, []);

  const selected = applications.find((a) => a.id === selectedId) ?? null;
  const value = useMemo(
    () => ({ applications, loading, error, selectedId: selected?.id ?? null, selected, select, reload, upsert }),
    [applications, loading, error, selected, select, reload, upsert],
  );
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace outside WorkspaceProvider');
  return ctx;
}
