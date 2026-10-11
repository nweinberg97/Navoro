/**
 * Typed client for the Navoro admin API (see packages/contracts/src/admin-types.ts).
 * - same-origin credentials, JSON in/out
 * - `x-navoro-csrf` on every mutation (token from /api/auth/me, login or signup)
 * - non-2xx → ApiRequestError carrying the contract's { error: { code, message } }
 * - 401 on admin routes → redirect to /login?next=…
 */
import type {
  AnalyticsResponse,
  ApiError,
  ApplicationDetail,
  ApplicationSummary,
  AuditEventDTO,
  BlueprintDTO,
  CatalogElementDTO,
  CatalogImportRequest,
  ConfigVersionDTO,
  CreateApplicationRequest,
  CreateSourceRequest,
  GuidancePreviewResponse,
  InviteMemberRequest,
  JobDTO,
  KnowledgeItemDTO,
  LoginRequest,
  MappingDTO,
  MeResponse,
  OverviewResponse,
  PrivacyPolicyDTO,
  PrivacyPolicyInput,
  ProviderStatusDTO,
  PublishRequest,
  Role,
  SettingsResponse,
  SignupRequest,
  SourceDetailDTO,
  SourceDTO,
  UpdateApplicationRequest,
  UpdateEnvironmentRequest,
  UpdateSettingsRequest,
  UpdateSourceRequest,
  UpdateStepRequest,
  UpdateWorkflowRequest,
  UpsertMappingRequest,
  WorkflowDetailDTO,
  WorkflowDTO,
} from '../../../packages/contracts/src/admin-types.ts';
import type { EnvironmentName } from '../../../packages/contracts/src/sdk-types.ts';

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Human-readable message for any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message;
  if (err instanceof TypeError) return 'Could not reach the Navoro server. Check your connection and try again.';
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}

let csrfToken: string | null = null;
export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestOptions {
  body?: unknown;
  signal?: AbortSignal;
  /** Don't redirect to /login on 401 (used for /api/auth/*). */
  noAuthRedirect?: boolean;
}

function redirectToLogin() {
  const { pathname, search } = window.location;
  if (pathname === '/login' || pathname === '/signup') return;
  const next = encodeURIComponent(pathname + search);
  window.location.assign(`/login?next=${next}`);
}

async function request<T>(method: Method, path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['x-navoro-csrf'] = csrfToken;

  const res = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    if (res.status === 401 && !opts.noAuthRedirect) {
      redirectToLogin();
    }
    const err = (data as ApiError | null)?.error;
    throw new ApiRequestError(
      res.status,
      err?.code ?? `http_${res.status}`,
      err?.message ?? (res.status >= 500 ? 'The server had a problem completing this request.' : `Request failed (${res.status}).`),
      err?.details,
    );
  }
  return data as T;
}

const enc = encodeURIComponent;
const A = '/api/admin';

export const api = {
  /* auth */
  me: (signal?: AbortSignal) => request<MeResponse>('GET', '/api/auth/me', { signal, noAuthRedirect: true }),
  login: (body: LoginRequest) => request<MeResponse>('POST', '/api/auth/login', { body, noAuthRedirect: true }),
  signup: (body: SignupRequest) => request<MeResponse>('POST', '/api/auth/signup', { body, noAuthRedirect: true }),
  logout: () => request<{ ok: boolean }>('POST', '/api/auth/logout', { noAuthRedirect: true }),

  /* overview */
  overview: (signal?: AbortSignal) => request<OverviewResponse>('GET', `${A}/overview`, { signal }),

  /* applications */
  applications: (signal?: AbortSignal) => request<{ applications: ApplicationSummary[] }>('GET', `${A}/applications`, { signal }),
  createApplication: (body: CreateApplicationRequest) => request<ApplicationDetail>('POST', `${A}/applications`, { body }),
  application: (id: string, signal?: AbortSignal) => request<ApplicationDetail>('GET', `${A}/applications/${enc(id)}`, { signal }),
  updateApplication: (id: string, body: UpdateApplicationRequest) => request<ApplicationDetail>('PATCH', `${A}/applications/${enc(id)}`, { body }),
  updateEnvironment: (id: string, env: EnvironmentName, body: UpdateEnvironmentRequest) =>
    request<ApplicationDetail>('PUT', `${A}/applications/${enc(id)}/environments/${env}`, { body }),
  publish: (id: string, body: PublishRequest) => request<ConfigVersionDTO>('POST', `${A}/applications/${enc(id)}/publish`, { body }),
  catalog: (id: string, signal?: AbortSignal) => request<{ elements: CatalogElementDTO[] }>('GET', `${A}/applications/${enc(id)}/catalog`, { signal }),
  setCatalogApproved: (id: string, elementId: string, approved: boolean) =>
    request<CatalogElementDTO>('PATCH', `${A}/applications/${enc(id)}/catalog/${enc(elementId)}`, { body: { approved } }),
  importCatalog: (id: string, body: CatalogImportRequest) =>
    request<{ elements: CatalogElementDTO[] }>('POST', `${A}/applications/${enc(id)}/catalog`, { body }),
  blueprints: (id: string, signal?: AbortSignal) => request<{ blueprints: BlueprintDTO[] }>('GET', `${A}/applications/${enc(id)}/blueprints`, { signal }),

  /* knowledge sources */
  sources: (appId: string, signal?: AbortSignal) => request<{ sources: SourceDTO[] }>('GET', `${A}/applications/${enc(appId)}/sources`, { signal }),
  createSource: (appId: string, body: CreateSourceRequest) => request<SourceDTO>('POST', `${A}/applications/${enc(appId)}/sources`, { body }),
  sampleSource: (appId: string) => request<SourceDTO>('POST', `${A}/applications/${enc(appId)}/sources/sample`),
  source: (id: string, signal?: AbortSignal) => request<SourceDetailDTO>('GET', `${A}/sources/${enc(id)}`, { signal }),
  updateSource: (id: string, body: UpdateSourceRequest) => request<SourceDTO>('PATCH', `${A}/sources/${enc(id)}`, { body }),
  deleteSource: (id: string) => request<{ ok: boolean }>('DELETE', `${A}/sources/${enc(id)}`),

  /* guidance */
  workflows: (appId: string, signal?: AbortSignal) => request<{ workflows: WorkflowDTO[] }>('GET', `${A}/applications/${enc(appId)}/workflows`, { signal }),
  workflow: (id: string, signal?: AbortSignal) => request<WorkflowDetailDTO>('GET', `${A}/workflows/${enc(id)}`, { signal }),
  updateWorkflow: (id: string, body: UpdateWorkflowRequest) => request<WorkflowDetailDTO>('PATCH', `${A}/workflows/${enc(id)}`, { body }),
  updateStep: (id: string, stepId: string, body: UpdateStepRequest) =>
    request<WorkflowDetailDTO>('PATCH', `${A}/workflows/${enc(id)}/steps/${enc(stepId)}`, { body }),
  knowledge: (appId: string, signal?: AbortSignal) => request<{ items: KnowledgeItemDTO[] }>('GET', `${A}/applications/${enc(appId)}/knowledge`, { signal }),
  mappings: (appId: string, signal?: AbortSignal) => request<{ mappings: MappingDTO[] }>('GET', `${A}/applications/${enc(appId)}/mappings`, { signal }),
  upsertMapping: (appId: string, key: string, body: UpsertMappingRequest) =>
    request<MappingDTO>('PUT', `${A}/applications/${enc(appId)}/mappings/${enc(key)}`, { body }),
  preview: (appId: string, body: { question: string; route?: string }) =>
    request<GuidancePreviewResponse>('POST', `${A}/applications/${enc(appId)}/preview`, { body }),

  /* jobs */
  refresh: (appId: string) => request<JobDTO>('POST', `${A}/applications/${enc(appId)}/refresh`),
  jobs: (appId: string, signal?: AbortSignal) => request<{ jobs: JobDTO[] }>('GET', `${A}/jobs?applicationId=${enc(appId)}`, { signal }),
  job: (id: string, signal?: AbortSignal) => request<JobDTO>('GET', `${A}/jobs/${enc(id)}`, { signal }),
  cancelJob: (id: string) => request<JobDTO>('POST', `${A}/jobs/${enc(id)}/cancel`),

  /* privacy */
  privacy: (appId: string, signal?: AbortSignal) => request<PrivacyPolicyDTO>('GET', `${A}/applications/${enc(appId)}/privacy`, { signal }),
  savePrivacy: (appId: string, body: PrivacyPolicyInput) => request<PrivacyPolicyDTO>('PUT', `${A}/applications/${enc(appId)}/privacy`, { body }),

  /* analytics + audit */
  analytics: (appId: string, days: number, signal?: AbortSignal) =>
    request<AnalyticsResponse>('GET', `${A}/applications/${enc(appId)}/analytics?days=${days}`, { signal }),
  audit: (signal?: AbortSignal) => request<{ events: AuditEventDTO[] }>('GET', `${A}/audit`, { signal }),

  /* settings */
  settings: (signal?: AbortSignal) => request<SettingsResponse>('GET', `${A}/settings`, { signal }),
  updateSettings: (body: UpdateSettingsRequest) => request<SettingsResponse>('PATCH', `${A}/settings`, { body }),
  addMember: (body: InviteMemberRequest) => request<SettingsResponse>('POST', `${A}/members`, { body }),
  setMemberRole: (userId: string, role: Role) => request<SettingsResponse>('PATCH', `${A}/members/${enc(userId)}`, { body: { role } }),
  provider: (signal?: AbortSignal) => request<ProviderStatusDTO>('GET', `${A}/provider`, { signal }),
};
