/**
 * Configuration publishing and public SDK configuration delivery.
 *
 * Publishing freezes a snapshot (privacy policy, live workflow ids, approved
 * element ids, launcher settings) as an immutable, numbered configuration
 * version and points an environment at it. The SDK only ever receives the
 * public projection of the active snapshot — never admin data or secrets.
 */
import type { Tenant } from '../data/tenant.ts';
import { defaultPrivacyPolicy, type ApplicationRow, type ConfigSnapshot, type StoredPrivacyPolicy } from '../data/types.ts';
import { parseJson } from '../db/database.ts';
import type { EnvironmentName, PublicSdkConfig } from '../../packages/contracts/src/sdk-types.ts';

/** Always enforced in the SDK regardless of configuration. */
export const BUILT_IN_EXCLUSIONS = [
  'Password and one-time-code inputs (type=password, autocomplete=current-password/new-password/one-time-code)',
  'Payment card inputs (autocomplete=cc-*)',
  'Elements marked data-navoro-sensitive or data-navoro-ignore, and everything inside them',
  'Fields whose name or id suggests secrets: password, token, API key, card, CVV, SSN, IBAN',
  'Input values, placeholders and keystrokes — never read, for any field',
  'Elements without an approved data-navoro-id (allowlist-first)',
];

export function buildSnapshot(t: Tenant, app: ApplicationRow): ConfigSnapshot {
  const draft = t.privacy.draft(app.id)?.policy ?? defaultPrivacyPolicy();
  const workflowIds = t.guidance
    .workflows(app.id)
    .filter((workflow) => workflow.status === 'published')
    .map((workflow) => workflow.id);
  return {
    privacy: draft,
    workflowIds,
    approvedNavoroIds: t.apps.approvedNavoroIds(app.id),
    launcher: {
      greeting: app.greeting,
      suggestions: parseJson<string[]>(app.suggestions, []),
      supportUrl: app.support_url,
    },
  };
}

export function publish(t: Tenant, app: ApplicationRow, environment: EnvironmentName, notes: string | null, userId: string | null): { id: string; version: number; snapshot: ConfigSnapshot } {
  const snapshot = buildSnapshot(t, app);
  if (!snapshot.privacy.environments.includes(environment)) {
    throw new PublishError(`The privacy policy does not allow the ${environment} environment. Enable it in Privacy & Security first.`);
  }
  const created = t.apps.createConfigVersion(app.id, environment, snapshot, notes, userId);
  t.activity.audit({
    actorUserId: userId,
    action: 'config.published',
    targetType: 'application',
    targetId: app.id,
    summary: `Published configuration v${created.version} to ${environment} (${snapshot.workflowIds.length} workflows, ${snapshot.privacy.neverCollect.length} never-collect rules)`,
    detail: { version: created.version, environment },
  });
  return { ...created, snapshot };
}

export class PublishError extends Error {}

/** Conservative policy used before an environment has any published configuration. */
function unpublishedPolicy(): StoredPrivacyPolicy {
  return { ...defaultPrivacyPolicy(), transmit: ['route', 'pageTitle', 'headings', 'visibleErrors'] };
}

export function activeSnapshot(t: Tenant, app: ApplicationRow, environment: EnvironmentName): { version: number; snapshot: ConfigSnapshot } {
  const active = t.apps.activeSnapshot(app.id, environment);
  if (active) return active;
  return {
    version: 0,
    snapshot: {
      privacy: unpublishedPolicy(),
      workflowIds: [],
      approvedNavoroIds: [],
      launcher: { greeting: app.greeting, suggestions: parseJson<string[]>(app.suggestions, []), supportUrl: app.support_url },
    },
  };
}

export function publicConfig(app: ApplicationRow, environment: EnvironmentName, version: number, snapshot: ConfigSnapshot): PublicSdkConfig {
  const policy = snapshot.privacy;
  const transmit = policy.transmit.filter((category) => policy.observe.includes(category));
  return {
    applicationName: app.name,
    environment,
    configVersion: version,
    privacy: {
      observe: policy.observe,
      transmit,
      blockedNavoroIds: policy.neverCollect.filter((rule) => rule.kind === 'navoro_id').map((rule) => rule.value),
      blockedSelectors: policy.neverCollect.filter((rule) => rule.kind === 'selector').map((rule) => rule.value),
      approvedNavoroIds: snapshot.approvedNavoroIds,
      allowlistOnly: true,
    },
    analyticsEnabled: policy.analyticsEnabled,
    discoveryEnabled: environment === 'development' && policy.discoveryInDevelopment,
    launcher: {
      position: 'bottom-right',
      greeting: snapshot.launcher.greeting,
      suggestions: snapshot.launcher.suggestions.slice(0, 4),
    },
    supportUrl: snapshot.launcher.supportUrl,
  };
}
