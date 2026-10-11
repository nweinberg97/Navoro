/**
 * Navoro SDK ⇄ backend contract, version 1.
 *
 * Pure types only (no runtime code) so the browser SDK can import them without
 * pulling a validation library into its bundle. The server validates every
 * inbound payload against the zod schemas in `sdk.ts`, which are type-checked
 * against these definitions.
 *
 * Wire paths (all under the Navoro API origin):
 *   POST /api/sdk/v1/init       → SdkInitResponse
 *   POST /api/sdk/v1/guidance   → NDJSON stream of GuidanceStreamEvent
 *   POST /api/sdk/v1/events     → { ok: true }
 *   POST /api/sdk/v1/discovery  → { ok: true, accepted: number }   (development environments only)
 */

export const SDK_API_VERSION = 1 as const;

export type EnvironmentName = 'development' | 'production';

/** Context categories the SDK may collect. Each is individually allowlisted by policy. */
export type ContextCategory =
  | 'route'
  | 'pageTitle'
  | 'headings'
  | 'elements'
  | 'fieldLabels'
  | 'visibleErrors';

export interface SdkInitRequest {
  publicKey: string;
  environment: EnvironmentName;
  sdkVersion: string;
}

/** Public, non-secret configuration delivered to the SDK. Never contains admin data. */
export interface PublicPrivacyPolicy {
  /** Categories the SDK may observe locally. Anything not listed is never read. */
  observe: ContextCategory[];
  /** Subset of `observe` that may be sent to the backend / AI provider. */
  transmit: ContextCategory[];
  /** Elements whose subtree must never be read. Matched by data-navoro-id. */
  blockedNavoroIds: string[];
  /** Additional CSS selectors (admin-authored, validated server-side) for blocked regions. */
  blockedSelectors: string[];
  /**
   * Allowlist: only elements whose data-navoro-id appears here (approved application
   * metadata) may contribute labels/state to the outbound context. Unknown elements
   * are never transmitted. `['*']` (local mode without an element list) means every
   * element the developer tagged with data-navoro-id is approved: tagging is the opt-in.
   */
  approvedNavoroIds: string[];
  allowlistOnly: true;
}

export interface PublicSdkConfig {
  applicationName: string;
  environment: EnvironmentName;
  configVersion: number;
  privacy: PublicPrivacyPolicy;
  analyticsEnabled: boolean;
  /** Whether this environment accepts element discovery (development only). */
  discoveryEnabled: boolean;
  launcher: {
    position: 'bottom-right' | 'bottom-left';
    greeting: string;
    suggestions: string[];
  };
  supportUrl: string | null;
}

export interface SdkInitResponse {
  apiVersion: typeof SDK_API_VERSION;
  /** Short-lived signed token binding application, environment and origin. */
  sessionToken: string;
  expiresAt: string;
  config: PublicSdkConfig;
}

/** One observed element. Values of inputs are NEVER included. */
export interface ObservedElement {
  navoroId: string;
  role: string | null;
  /** Accessible name / visible label, truncated, only for allowlisted elements. */
  label: string | null;
  /** True when the element is disabled or aria-disabled. */
  disabled: boolean;
  /** True if the element currently has an invalid state (aria-invalid). */
  invalid: boolean;
}

export interface VisibleError {
  /** Developer-provided code from data-navoro-error, if any. */
  code: string | null;
  /** Visible message text, truncated, only from elements marked data-navoro-error. */
  message: string | null;
  /** navoro id of the closest annotated ancestor/field, if any. */
  nearNavoroId: string | null;
}

/** The sanitized context payload. Constructed from allowlisted fields only. */
export interface SanitizedContext {
  route?: string;
  pageTitle?: string;
  headings?: string[];
  elements?: ObservedElement[];
  fieldLabels?: string[];
  visibleErrors?: VisibleError[];
}

export interface GuidanceRequest {
  question: string;
  context: SanitizedContext;
  /** Client-generated id so the server can de-duplicate and the client can drop stale responses. */
  requestId: string;
  /** Present when the user is already inside a guidance session. */
  sessionId?: string;
}

export type MatchStrategy =
  | { type: 'navoro_id'; value: string }
  | { type: 'aria_label'; value: string; role?: string }
  | { type: 'text'; value: string; role?: string };

export interface GuidanceTarget {
  key: string;
  label: string;
  /** Ordered, most-stable first. The SDK tries each in order and never executes code. */
  strategies: MatchStrategy[];
  confidence: number;
  validation: 'valid' | 'unverified' | 'uncertain';
}

export interface GuidanceStep {
  index: number;
  title: string;
  instruction: string;
  target: GuidanceTarget | null;
  /** Why the target is missing when it is null (e.g. mapping broken). */
  targetNote: string | null;
}

export interface Citation {
  sourceId: string;
  sourceTitle: string;
  excerpt: string;
}

export type GuidanceKind = 'workflow' | 'answer' | 'troubleshooting' | 'unresolved';

export interface GuidanceResult {
  sessionId: string;
  requestId: string;
  kind: GuidanceKind;
  /** Plain text. The SDK renders it with textContent, never as HTML. */
  answer: string;
  grounded: boolean;
  confidence: number;
  workflow: { id: string; title: string } | null;
  steps: GuidanceStep[];
  citations: Citation[];
  /**
   * 'llm': a configured model produced the answer on the Navoro server.
   * 'demo': the Navoro server assembled it from retrieved docs without a model.
   * 'local': answered entirely in the browser from a knowledge pack; nothing was sent anywhere.
   */
  mode: 'llm' | 'demo' | 'local';
  /** Suggested next action when the answer is unresolved or low-confidence. */
  fallback: { label: string; url: string | null } | null;
}

export type GuidanceStreamEvent =
  | { type: 'status'; phase: 'retrieving' | 'reasoning' | 'validating' }
  | { type: 'result'; result: GuidanceResult }
  | { type: 'error'; code: GuidanceErrorCode; message: string; retryable: boolean };

export type GuidanceErrorCode =
  | 'rate_limited'
  | 'invalid_request'
  | 'unauthorized'
  | 'provider_unavailable'
  | 'timeout'
  | 'internal';

export type SdkEventType =
  | 'launcher_opened'
  | 'guidance_shown'
  | 'step_viewed'
  | 'step_target_missing'
  | 'workflow_completed'
  | 'guidance_dismissed'
  | 'request_cancelled'
  | 'feedback_helpful'
  | 'feedback_not_helpful';

export interface SdkEvent {
  type: SdkEventType;
  sessionId?: string;
  workflowId?: string;
  stepIndex?: number;
  mappingKey?: string;
}

export interface SdkEventsRequest {
  events: SdkEvent[];
}

/** Structural page blueprint for Training Mode. Contains NO text content or values. */
export interface DiscoveredElement {
  navoroId: string;
  role: string | null;
  label: string | null;
  tag: string;
  inputType: string | null;
  /** Bounding box relative to the document, rounded to whole pixels. */
  rect: { x: number; y: number; width: number; height: number };
}

export interface DiscoveryRequest {
  route: string;
  viewport: { width: number; height: number };
  documentHeight: number;
  elements: DiscoveredElement[];
}

// ── Knowledge packs (offline / local mode) ───────────────────────────────────
//
// A knowledge pack is everything the SDK needs to answer and guide without a
// server: structured workflows, troubleshooting rules, UI terms, searchable
// passages, element mappings and the privacy policy. It is produced at build
// time by `navoro-pack` (scripts/navoro-pack.ts) from a navoro.config.json and
// served as a static file next to the app. In local mode the SDK makes no
// network requests other than fetching this file from the app's own origin.

export const KNOWLEDGE_PACK_FORMAT = 'navoro-pack' as const;
export const KNOWLEDGE_PACK_VERSION = 1 as const;

export interface PackWorkflow {
  id: string;
  title: string;
  summary: string;
  kind: 'task' | 'onboarding' | 'troubleshooting';
  prerequisites: string[];
  confidence: number;
  sourceTitle: string;
  excerpt: string;
  steps: Array<{ title: string; instruction: string; targetKey: string | null }>;
}

export interface PackItem {
  id: string;
  kind: 'feature' | 'ui_concept' | 'known_error' | 'troubleshooting';
  title: string;
  body: string;
  /** known_error: code, resolution, labels. ui_concept: label. */
  data: { code?: string | null; resolution?: string | null; labels?: string[]; label?: string };
  sourceTitle: string;
}

export interface PackChunk {
  id: string;
  heading: string | null;
  text: string;
  sourceTitle: string;
}

export interface PackMapping {
  key: string;
  label: string;
  strategies: MatchStrategy[];
  confidence: number;
  validation: 'valid' | 'unverified' | 'uncertain' | 'broken';
}

export interface KnowledgePack {
  format: typeof KNOWLEDGE_PACK_FORMAT;
  version: typeof KNOWLEDGE_PACK_VERSION;
  builtAt: string;
  /** Short content hash; changes whenever the pack's content changes. */
  hash: string;
  application: { name: string };
  launcher: { greeting: string; suggestions: string[] };
  supportUrl: string | null;
  /** Where unsolved problems go: the Contact support button opens an email to this address. */
  supportEmail: string | null;
  /**
   * Privacy policy enforced in the browser. In local mode nothing is transmitted, so
   * `observe` is what the on-device engine may read; never-collect rules and the
   * built-in blinders apply exactly as in hosted mode.
   */
  privacy: {
    observe: ContextCategory[];
    blockedNavoroIds: string[];
    blockedSelectors: string[];
    approvedNavoroIds: string[];
  };
  sources: Array<{ title: string; hash: string }>;
  workflows: PackWorkflow[];
  items: PackItem[];
  chunks: PackChunk[];
  mappings: PackMapping[];
}
