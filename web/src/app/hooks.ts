import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from './api.ts';

export interface Resource<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Re-fetch; keeps existing data visible while reloading. */
  reload: () => void;
  /** Replace data locally (e.g. with a mutation response). */
  setData: (next: T | ((prev: T | null) => T | null)) => void;
}

/**
 * Loads data with an AbortSignal; aborts on unmount and when `deps` change.
 * Pass `enabled=false` to skip loading (e.g. no application selected).
 */
export function useResource<T>(loader: (signal: AbortSignal) => Promise<T>, deps: unknown[], enabled = true): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    loaderRef
      .current(ctrl.signal)
      .then((d) => {
        if (!ctrl.signal.aborted) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
        setError(errorMessage(e));
        setLoading(false);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload, setData: setData as Resource<T>['setData'] };
}

/**
 * Calls `tick` every `ms` while `active` is true. Uses setTimeout chaining so a
 * slow request never overlaps the next one. Cleans up on unmount / deactivate.
 */
export function usePolling(tick: (signal: AbortSignal) => Promise<void>, ms: number, active: boolean) {
  const tickRef = useRef(tick);
  tickRef.current = tick;
  useEffect(() => {
    if (!active) return;
    const ctrl = new AbortController();
    let timer: number | undefined;
    const run = async () => {
      try {
        await tickRef.current(ctrl.signal);
      } catch {
        // Errors are surfaced by the caller; keep polling.
      }
      if (!ctrl.signal.aborted) timer = window.setTimeout(run, ms);
    };
    timer = window.setTimeout(run, ms);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [ms, active]);
}

/** Tracks an async mutation's busy state. */
export function useMutation<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const run = useCallback(async (...args: A): Promise<R> => {
    setBusy(true);
    try {
      return await fnRef.current(...args);
    } finally {
      setBusy(false);
    }
  }, []);
  return { run, busy };
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Navoro` : 'Navoro';
  }, [title]);
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const on = () => setMatches(mql.matches);
    mql.addEventListener('change', on);
    on();
    return () => mql.removeEventListener('change', on);
  }, [query]);
  return matches;
}
