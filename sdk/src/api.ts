/**
 * Networking for the SDK⇄backend contract (v1). Uses fetch + AbortController only.
 */
import type {
  DiscoveryRequest,
  EnvironmentName,
  GuidanceRequest,
  GuidanceStreamEvent,
  PublicSdkConfig,
  SdkEvent,
  SdkEventsRequest,
  SdkInitRequest,
} from '../../packages/contracts/src/sdk-types.ts';
import { isSdkInitResponse, parseStreamEvent } from './validate.ts';

/** Client-side request timeout for guidance (ms). */
export const GUIDANCE_TIMEOUT_MS = 15_000;
const MAX_LINE = 1_000_000;

export type ApiErrorKind = 'origin_not_allowed' | 'unauthorized' | 'http' | 'network' | 'invalid_response' | 'timeout' | 'aborted';

/** Transport-level failure. User-facing copy is chosen by the controller from `kind`. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  constructor(kind: ApiErrorKind, status = 0) {
    super(`Navoro request failed: ${kind}${status ? ` (${status})` : ''}`);
    this.kind = kind;
    this.status = status;
  }
}

/**
 * Incremental NDJSON splitter. `push` accepts decoded text chunks and calls
 * `onLine` for every complete, non-empty line; `end` flushes the remainder.
 */
export function createLineSplitter(onLine: (line: string) => void): { push(chunk: string): void; end(): void } {
  let buffer = '';
  return {
    push(chunk) {
      buffer += chunk;
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) onLine(line);
        nl = buffer.indexOf('\n');
      }
      if (buffer.length > MAX_LINE) throw new ApiError('invalid_response');
    },
    end() {
      const line = buffer.trim();
      buffer = '';
      if (line) onLine(line);
    },
  };
}

/** Parses one NDJSON line into a validated stream event (null when malformed). */
export function parseStreamLine(line: string): GuidanceStreamEvent | null {
  try {
    return parseStreamEvent(JSON.parse(line));
  } catch {
    return null;
  }
}

/** Links an external signal and a timeout into one controller. */
function linkedController(external: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; timedOut: () => boolean; dispose: () => void } {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  if (external?.aborted) controller.abort();
  external?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      external?.removeEventListener('abort', onAbort);
    },
  };
}

export interface ApiOptions {
  apiOrigin: string;
  publicKey: string;
  environment: EnvironmentName;
  sdkVersion: string;
}

/** Thin, stateful client: holds the session token and transparently re-inits when it expires. */
export class NavoroApi {
  readonly #opts: ApiOptions;
  #token: string | null = null;
  #expiresAt = 0;
  #initPromise: Promise<PublicSdkConfig> | null = null;

  constructor(opts: ApiOptions) {
    this.#opts = { ...opts, apiOrigin: opts.apiOrigin.replace(/\/+$/, '') };
  }

  /** JSON POST to /api/sdk/v1/{path}. Never sends cookies. */
  #post(path: string, body: unknown, token: string | null, init: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(`${this.#opts.apiOrigin}/api/sdk/v1/${path}`, { ...init, method: 'POST', credentials: 'omit', headers, body: JSON.stringify(body) });
  }

  /** POST /init. Throws ApiError('origin_not_allowed') on 403. De-duplicates concurrent calls. */
  init(): Promise<PublicSdkConfig> {
    this.#initPromise ??= this.#doInit().finally(() => {
      this.#initPromise = null;
    });
    return this.#initPromise;
  }

  async #doInit(): Promise<PublicSdkConfig> {
    const body: SdkInitRequest = {
      publicKey: this.#opts.publicKey,
      environment: this.#opts.environment,
      sdkVersion: this.#opts.sdkVersion,
    };
    const link = linkedController(undefined, GUIDANCE_TIMEOUT_MS);
    let res: Response;
    try {
      res = await this.#post('init', body, null, { signal: link.signal });
    } catch {
      throw new ApiError(link.timedOut() ? 'timeout' : 'network');
    } finally {
      link.dispose();
    }
    if (res.status === 403) throw new ApiError('origin_not_allowed', 403);
    if (res.status === 401) throw new ApiError('unauthorized', 401);
    if (!res.ok) throw new ApiError('http', res.status);
    const json: unknown = await res.json().catch(() => null);
    if (!isSdkInitResponse(json)) throw new ApiError('invalid_response');
    this.#token = json.sessionToken;
    const expires = Date.parse(json.expiresAt);
    this.#expiresAt = Number.isFinite(expires) ? expires : Date.now() + 5 * 60_000;
    return json.config;
  }

  /** Returns a valid token, re-initializing when it is (about to be) expired. */
  async #ensureToken(): Promise<string> {
    if (!this.#token || Date.now() > this.#expiresAt - 30_000) await this.init();
    if (!this.#token) throw new ApiError('unauthorized');
    return this.#token;
  }

  async #authedPost(path: string, body: unknown, init: RequestInit = {}): Promise<Response> {
    let res = await this.#post(path, body, await this.#ensureToken(), init);
    if (res.status === 401) {
      // Token rejected (rotated / expired early): re-init once and retry.
      this.#token = null;
      res = await this.#post(path, body, await this.#ensureToken(), init);
    }
    return res;
  }

  /**
   * POST /guidance and read the NDJSON stream. `onEvent` is called for every
   * validated event, in order. Malformed lines are skipped. Rejects with ApiError
   * on transport failure, timeout (15s) or abort.
   */
  async streamGuidance(request: GuidanceRequest, signal: AbortSignal, onEvent: (event: GuidanceStreamEvent) => void): Promise<void> {
    const link = linkedController(signal, GUIDANCE_TIMEOUT_MS);
    const fail = (): ApiError => new ApiError(signal.aborted ? 'aborted' : link.timedOut() ? 'timeout' : 'network');
    try {
      let res: Response;
      try {
        res = await this.#authedPost('guidance', request, { signal: link.signal });
      } catch (err) {
        throw err instanceof ApiError && !link.signal.aborted ? err : fail();
      }
      if (res.status === 403) throw new ApiError('origin_not_allowed', 403);
      if (!res.ok || !res.body) {
        // Servers may still answer errors as a single NDJSON/JSON error event.
        const text = await res.text().catch(() => '');
        const event = parseStreamLine(text.split('\n')[0] ?? '');
        if (event?.type === 'error') {
          onEvent(event);
          return;
        }
        throw new ApiError(res.status === 401 ? 'unauthorized' : 'http', res.status);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const splitter = createLineSplitter((line) => {
        const event = parseStreamLine(line);
        if (event) onEvent(event);
      });
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          splitter.push(decoder.decode(value, { stream: true }));
        }
        splitter.push(decoder.decode());
        splitter.end();
      } catch (err) {
        reader.cancel().catch(() => undefined);
        throw err instanceof ApiError ? err : fail();
      }
    } finally {
      link.dispose();
    }
  }

  /** POST /events. Fire-and-forget; `keepalive` lets it survive pagehide. */
  async postEvents(events: SdkEvent[], keepalive = false): Promise<void> {
    if (events.length === 0) return;
    const body: SdkEventsRequest = { events };
    try {
      // On pagehide we cannot await a re-init; send only with a current token.
      if (keepalive) {
        if (!this.#token || Date.now() > this.#expiresAt) return;
        await this.#post('events', body, this.#token, { keepalive: true });
        return;
      }
      await this.#authedPost('events', body);
    } catch {
      // analytics are best-effort
    }
  }

  /** POST /discovery (development environments only). Best-effort. */
  async postDiscovery(request: DiscoveryRequest): Promise<void> {
    try {
      await this.#authedPost('discovery', request);
    } catch {
      // best-effort
    }
  }
}

/** Batches analytics events with a short debounce; flushes with keepalive on pagehide. */
export class EventQueue {
  #queue: SdkEvent[] = [];
  #timer: ReturnType<typeof setTimeout> | null = null;
  readonly #send: (events: SdkEvent[], keepalive: boolean) => void;
  readonly #delay: number;

  constructor(send: (events: SdkEvent[], keepalive: boolean) => void, delayMs = 2000) {
    this.#send = send;
    this.#delay = delayMs;
  }

  /** Enqueue an event. Only ids/indices are accepted by type — never question text. */
  push(event: SdkEvent): void {
    // Copy only the contract's id/index fields; anything else (e.g. text) is dropped.
    const clean: Record<string, unknown> = { type: event.type };
    for (const k of ['sessionId', 'workflowId', 'stepIndex', 'mappingKey'] as const) {
      if (event[k] !== undefined && event[k] !== '') clean[k] = event[k];
    }
    this.#queue.push(clean as unknown as SdkEvent);
    if (this.#queue.length >= 20) this.flush();
    else this.#timer ??= setTimeout(() => this.flush(), this.#delay);
  }

  flush(keepalive = false): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    if (this.#queue.length === 0) return;
    const batch = this.#queue.splice(0, 50);
    this.#send(batch, keepalive);
    if (this.#queue.length > 0) this.flush(keepalive);
  }

  dispose(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#queue = [];
  }
}
