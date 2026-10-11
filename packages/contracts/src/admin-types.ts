/**
 * Admin (dashboard) API DTOs. Pure types, shared by the server and the dashboard SPA.
 *
 * Every admin route lives under /api/admin, requires a session cookie, and every
 * mutating request (POST/PUT/PATCH/DELETE) must carry the `x-navoro-csrf` header
 * whose value is `MeResponse.csrfToken`. Errors are returned as `ApiError` with a
 * non-2xx status.
 *
 * Routes (org scope comes from the session, never from the request body):
 *   POST   /api/auth/signup                 SignupRequest            → MeResponse
 *   POST   /api/auth/login                  LoginRequest             → MeResponse
 *   POST   /api/auth/logout                                          → { ok }
 *   GET    /api/auth/me                                              → MeResponse
 *
 *   GET    /api/admin/overview                                       → OverviewResponse
 *   GET    /api/admin/applications                                   → { applications: ApplicationSummary[] }
 *   POST   /api/admin/applications          CreateApplicationRequest → ApplicationDetail
 *   GET    /api/admin/applications/:id                               → ApplicationDetail
 *   PATCH  /api/admin/applications/:id      UpdateApplicationRequest → ApplicationDetail
 *   PUT    /api/admin/applications/:id/environments/:env  UpdateEnvironmentRequest → ApplicationDetail
 *   POST   /api/admin/applications/:id/publish   PublishRequest      → ConfigVersionDTO
 *   GET    /api/admin/applications/:id/catalog                       → { elements: CatalogElementDTO[] }
 *   PATCH  /api/admin/applications/:id/catalog/:elementId  { approved: boolean } → CatalogElementDTO
 *   POST   /api/admin/applications/:id/catalog   CatalogImportRequest → { elements: CatalogElementDTO[] }
 *   GET    /api/admin/applications/:id/blueprints                    → { blueprints: BlueprintDTO[] }
 *
 *   GET    /api/admin/applications/:id/sources                       → { sources: SourceDTO[] }
 *   POST   /api/admin/applications/:id/sources  CreateSourceRequest  → SourceDTO   (queues an ingest job)
 *   POST   /api/admin/applications/:id/sources/sample                → SourceDTO   (adds the sample Lumen docs)
 *   GET    /api/admin/sources/:id                                    → SourceDetailDTO
 *   PATCH  /api/admin/sources/:id           UpdateSourceRequest      → SourceDTO   (re-queues ingest)
 *   DELETE /api/admin/sources/:id                                    → { ok }
 *
 *   GET    /api/admin/applications/:id/workflows                     → { workflows: WorkflowDTO[] }
 *   GET    /api/admin/workflows/:id                                  → WorkflowDetailDTO
 *   PATCH  /api/admin/workflows/:id         UpdateWorkflowRequest    → WorkflowDetailDTO
 *   PATCH  /api/admin/workflows/:id/steps/:stepId  UpdateStepRequest → WorkflowDetailDTO
 *   GET    /api/admin/applications/:id/knowledge                     → { items: KnowledgeItemDTO[] }
 *   GET    /api/admin/applications/:id/mappings                      → { mappings: MappingDTO[] }
 *   PUT    /api/admin/applications/:id/mappings/:key  UpsertMappingRequest → MappingDTO
 *   POST   /api/admin/applications/:id/preview  { question, route? }  → GuidancePreviewResponse
 *
 *   POST   /api/admin/applications/:id/refresh                       → JobDTO
 *   GET    /api/admin/jobs?applicationId=…                           → { jobs: JobDTO[] }
 *   GET    /api/admin/jobs/:id                                       → JobDTO
 *   POST   /api/admin/jobs/:id/cancel                                → JobDTO
 *
 *   GET    /api/admin/applications/:id/privacy                       → PrivacyPolicyDTO
 *   PUT    /api/admin/applications/:id/privacy  PrivacyPolicyInput   → PrivacyPolicyDTO
 *
 *   GET    /api/admin/applications/:id/analytics?days=30             → AnalyticsResponse
 *   GET    /api/admin/audit                                          → { events: AuditEventDTO[] }
 *
 *   GET    /api/admin/settings                                       → SettingsResponse
 *   PATCH  /api/admin/settings              UpdateSettingsRequest    → SettingsResponse
 *   POST   /api/admin/members               InviteMemberRequest      → SettingsResponse
 *   PATCH  /api/admin/members/:userId       { role }                 → SettingsResponse
 *   GET    /api/admin/provider                                       → ProviderStatusDTO
 */

import type { EnvironmentName, ContextCategory, GuidanceResult, SanitizedContext } from './sdk-types.ts';

export type Role = 'owner' | 'admin' | 'member';

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface SignupRequest {
  name: string;
  email: string;
  password: string;
  organizationName: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface MeResponse {
  user: { id: string; email: string; name: string };
  organization: { id: string; name: string; slug: string };
  role: Role;
  csrfToken: string;
}

export interface ProviderStatusDTO {
  mode: 'llm' | 'demo';
  provider: string | null;
  model: string | null;
  /** Explanation shown in the UI, e.g. "ANTHROPIC_API_KEY is not set". */
  note: string;
}

export interface OverviewResponse {
  provider: ProviderStatusDTO;
  applications: Array<{
    id: string;
    name: string;
    connection: 'never_connected' | 'connected' | 'stale';
    lastSeenAt: string | null;
    publishedVersion: number | null;
  }>;
  sources: { total: number; ready: number; processing: number; needsAttention: number; failed: number; pending: number };
  freshness: { oldestProcessedAt: string | null; newestProcessedAt: string | null; staleCount: number };
  guidance: {
    sessions7d: number;
    answered7d: number;
    unresolved7d: number;
    completedWorkflows7d: number;
  };
  mappings: { total: number; valid: number; unverified: number; uncertain: number; broken: number };
  workflows: { published: number; draft: number; needsReview: number };
  recentActivity: AuditEventDTO[];
  nextActions: Array<{ id: string; title: string; description: string; href: string }>;
}

export interface EnvironmentDTO {
  id: string;
  name: EnvironmentName;
  allowedOrigins: string[];
  activeConfigVersion: number | null;
  lastSeenAt: string | null;
}

export interface ApplicationSummary {
  id: string;
  name: string;
  publicKey: string;
  createdAt: string;
  lastSeenAt: string | null;
  sdkVersion: string | null;
  environments: EnvironmentDTO[];
}

export interface ConfigVersionDTO {
  id: string;
  version: number;
  environment: EnvironmentName;
  notes: string | null;
  createdAt: string;
  createdBy: string | null;
  summary: { publishedWorkflows: number; blockedRegions: number; transmitCategories: ContextCategory[] };
}

export interface ApplicationDetail extends ApplicationSummary {
  supportUrl: string | null;
  greeting: string;
  suggestions: string[];
  configVersions: ConfigVersionDTO[];
  installSnippet: string;
  apiOrigin: string;
}

export interface CreateApplicationRequest {
  name: string;
  developmentOrigins: string[];
  productionOrigins: string[];
}

export interface UpdateApplicationRequest {
  name?: string;
  supportUrl?: string | null;
  greeting?: string;
  suggestions?: string[];
}

export interface UpdateEnvironmentRequest {
  allowedOrigins: string[];
}

export interface PublishRequest {
  environment: EnvironmentName;
  notes?: string;
}

export interface CatalogElementDTO {
  id: string;
  navoroId: string;
  label: string | null;
  role: string | null;
  route: string | null;
  source: 'sdk_discovery' | 'manual';
  approved: boolean;
  lastSeenAt: string;
}

export interface CatalogImportRequest {
  elements: Array<{ navoroId: string; label?: string; role?: string; route?: string }>;
}

export interface BlueprintDTO {
  id: string;
  route: string;
  viewport: { width: number; height: number };
  documentHeight: number;
  capturedAt: string;
  elements: Array<{
    navoroId: string;
    role: string | null;
    label: string | null;
    tag: string;
    inputType: string | null;
    rect: { x: number; y: number; width: number; height: number };
  }>;
}

export type SourceType = 'manual' | 'text' | 'file' | 'url' | 'youtube';
export type SourceStatus = 'pending' | 'processing' | 'ready' | 'needs_attention' | 'failed';

export interface SourceDTO {
  id: string;
  applicationId: string;
  type: SourceType;
  title: string;
  reference: string | null;
  status: SourceStatus;
  error: string | null;
  contentHash: string | null;
  charCount: number;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
  stats: { chunks: number; workflows: number; knowledgeItems: number };
}

export interface SourceDetailDTO extends SourceDTO {
  content: string;
  metadata: Record<string, unknown>;
}

export interface CreateSourceRequest {
  type: SourceType;
  title?: string;
  /** For manual/text/file. */
  content?: string;
  /** For url/youtube. Also the filename for `file`. */
  reference?: string;
}

export interface UpdateSourceRequest {
  title?: string;
  content?: string;
}

export type WorkflowStatus = 'draft' | 'published' | 'needs_review' | 'archived';
export type WorkflowKind = 'task' | 'onboarding' | 'troubleshooting';
export type MappingValidation = 'valid' | 'unverified' | 'uncertain' | 'broken';

export interface WorkflowDTO {
  id: string;
  applicationId: string;
  key: string;
  title: string;
  summary: string;
  kind: WorkflowKind;
  status: WorkflowStatus;
  confidence: number;
  origin: 'extracted' | 'manual';
  edited: boolean;
  stepCount: number;
  brokenTargets: number;
  sourceId: string | null;
  sourceTitle: string | null;
  updatedAt: string;
}

export interface WorkflowStepDTO {
  id: string;
  index: number;
  title: string;
  instruction: string;
  targetKey: string | null;
  target: MappingDTO | null;
  sourceExcerpt: string | null;
  edited: boolean;
}

export interface WorkflowDetailDTO extends WorkflowDTO {
  prerequisites: string[];
  steps: WorkflowStepDTO[];
}

export interface UpdateWorkflowRequest {
  title?: string;
  summary?: string;
  kind?: WorkflowKind;
  status?: WorkflowStatus;
}

export interface UpdateStepRequest {
  title?: string;
  instruction?: string;
  targetKey?: string | null;
}

export interface MappingDTO {
  id: string;
  key: string;
  label: string;
  strategies: Array<{ type: 'navoro_id' | 'aria_label' | 'text'; value: string; role?: string }>;
  provenance: 'developer_id' | 'extracted' | 'admin';
  confidence: number;
  validation: MappingValidation;
  validationDetail: string | null;
  updatedAt: string;
}

export interface UpsertMappingRequest {
  label: string;
  navoroId?: string;
  ariaLabel?: string;
  text?: string;
  role?: string;
}

export interface KnowledgeItemDTO {
  id: string;
  kind: 'feature' | 'ui_concept' | 'known_error' | 'troubleshooting';
  title: string;
  body: string;
  data: Record<string, unknown>;
  sourceId: string;
  sourceTitle: string;
}

export interface GuidancePreviewResponse {
  result: GuidanceResult;
  /** The sanitized context the preview used (synthetic). */
  context: SanitizedContext;
  retrieval: Array<{ sourceTitle: string; heading: string | null; score: number }>;
}

export type JobStatus = 'queued' | 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled';

export interface JobStepDTO {
  key: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  detail: string | null;
}

export interface RefreshReport {
  sourcesConsidered: number;
  sourcesChanged: number;
  sourcesUnchanged: number;
  sourcesFailed: Array<{ id: string; title: string; error: string }>;
  workflowsAdded: string[];
  workflowsUpdated: string[];
  workflowsRemoved: string[];
  workflowsNeedingReview: string[];
  mappingsValid: number;
  mappingsBroken: Array<{ key: string; label: string; detail: string }>;
  mappingsUncertain: Array<{ key: string; label: string; detail: string }>;
  published: { version: number; environment: EnvironmentName } | null;
  publishNote: string;
}

export interface JobDTO {
  id: string;
  applicationId: string | null;
  type: 'ingest' | 'refresh';
  status: JobStatus;
  steps: JobStepDTO[];
  report: RefreshReport | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface NeverCollectRule {
  id: string;
  kind: 'navoro_id' | 'selector';
  value: string;
  label: string;
  createdAt: string;
}

export interface PrivacyPolicyInput {
  observe: ContextCategory[];
  transmit: ContextCategory[];
  neverCollect: Array<{ kind: 'navoro_id' | 'selector'; value: string; label: string }>;
  retainQuestions: boolean;
  retentionDays: number;
  analyticsEnabled: boolean;
  discoveryInDevelopment: boolean;
  environments: EnvironmentName[];
}

export interface PrivacyPolicyDTO extends Omit<PrivacyPolicyInput, 'neverCollect'> {
  neverCollect: NeverCollectRule[];
  updatedAt: string;
  /** Rules always enforced by the SDK regardless of configuration. */
  builtInExclusions: string[];
  /** True when the draft differs from what is published to each environment. */
  unpublishedChanges: boolean;
}

export interface AnalyticsResponse {
  days: number;
  measured: string[];
  topTopics: Array<{ topic: string; count: number; unresolved: number }>;
  retainedQuestions: Array<{ text: string; count: number; grounded: boolean }> | null;
  sessions: { total: number; answered: number; unresolved: number; completed: number; dismissed: number; cancelled: number; errors: number };
  daily: Array<{ date: string; sessions: number; unresolved: number }>;
  errorStates: Array<{ code: string; count: number }>;
  stepAbandonment: Array<{ workflowId: string; workflowTitle: string; stepIndex: number; views: number; dropOffs: number }>;
  missingTargets: Array<{ key: string; count: number }>;
  staleSources: Array<{ id: string; title: string; processedAt: string | null; status: SourceStatus }>;
  lowConfidenceMappings: MappingDTO[];
  feedback: { helpful: number; notHelpful: number };
}

export interface AuditEventDTO {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  actor: string | null;
  summary: string;
  createdAt: string;
}

export interface SettingsResponse {
  organization: { id: string; name: string; slug: string; approvalPolicy: 'manual' | 'auto' };
  members: Array<{ userId: string; email: string; name: string; role: Role; createdAt: string }>;
  provider: ProviderStatusDTO;
}

export interface UpdateSettingsRequest {
  name?: string;
  approvalPolicy?: 'manual' | 'auto';
}

export interface InviteMemberRequest {
  email: string;
  name: string;
  role: Role;
  /** Initial password for the new member (no email delivery in this build). */
  password: string;
}
