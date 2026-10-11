/** Internal persisted shapes shared across data modules and services. */
import type { ContextCategory, EnvironmentName } from '../../packages/contracts/src/sdk-types.ts';
import type { NeverCollectRule } from '../../packages/contracts/src/admin-types.ts';

export const ALL_CATEGORIES: ContextCategory[] = ['route', 'pageTitle', 'headings', 'elements', 'fieldLabels', 'visibleErrors'];

export interface StoredPrivacyPolicy {
  observe: ContextCategory[];
  transmit: ContextCategory[];
  neverCollect: NeverCollectRule[];
  retainQuestions: boolean;
  retentionDays: number;
  analyticsEnabled: boolean;
  discoveryInDevelopment: boolean;
  environments: EnvironmentName[];
}

export function defaultPrivacyPolicy(): StoredPrivacyPolicy {
  return {
    observe: [...ALL_CATEGORIES],
    transmit: ['route', 'pageTitle', 'headings', 'elements', 'visibleErrors'],
    neverCollect: [],
    retainQuestions: false,
    retentionDays: 30,
    analyticsEnabled: true,
    discoveryInDevelopment: true,
    environments: ['development', 'production'],
  };
}

/** Immutable snapshot stored with each published configuration version. */
export interface ConfigSnapshot {
  privacy: StoredPrivacyPolicy;
  workflowIds: string[];
  approvedNavoroIds: string[];
  launcher: { greeting: string; suggestions: string[]; supportUrl: string | null };
}

export interface ApplicationRow {
  id: string;
  org_id: string;
  name: string;
  public_key: string;
  support_url: string | null;
  greeting: string;
  suggestions: string;
  sdk_version: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnvironmentRow {
  id: string;
  org_id: string;
  app_id: string;
  name: EnvironmentName;
  allowed_origins: string;
  active_config_version_id: string | null;
  last_seen_at: string | null;
}

export interface SourceRow {
  id: string;
  org_id: string;
  app_id: string;
  type: 'manual' | 'text' | 'file' | 'url' | 'youtube';
  title: string;
  reference: string | null;
  content: string;
  content_hash: string | null;
  processed_hash: string | null;
  status: 'pending' | 'processing' | 'ready' | 'needs_attention' | 'failed';
  error: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
}

export interface ChunkRow {
  id: string;
  source_id: string;
  ordinal: number;
  heading: string | null;
  text: string;
  source_title: string;
}

export interface MappingRow {
  id: string;
  org_id: string;
  app_id: string;
  key: string;
  label: string;
  strategies: string;
  provenance: 'developer_id' | 'extracted' | 'admin';
  confidence: number;
  validation: 'valid' | 'unverified' | 'uncertain' | 'broken';
  validation_detail: string | null;
  updated_at: string;
}

export interface WorkflowRow {
  id: string;
  org_id: string;
  app_id: string;
  source_id: string | null;
  key: string;
  title: string;
  summary: string;
  kind: 'task' | 'onboarding' | 'troubleshooting';
  status: 'draft' | 'published' | 'needs_review' | 'archived';
  confidence: number;
  origin: 'extracted' | 'manual';
  edited: number;
  prerequisites: string;
  source_hash: string | null;
  created_at: string;
  updated_at: string;
}

export interface StepRow {
  id: string;
  org_id: string;
  workflow_id: string;
  ordinal: number;
  title: string;
  instruction: string;
  target_key: string | null;
  validation: string | null;
  source_excerpt: string | null;
  edited: number;
}

export interface CatalogRow {
  id: string;
  org_id: string;
  app_id: string;
  navoro_id: string;
  label: string | null;
  role: string | null;
  route: string | null;
  source: 'sdk_discovery' | 'manual';
  approved: number;
  first_seen_at: string;
  last_seen_at: string;
}
