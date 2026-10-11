/**
 * Hand-written runtime guards for server data. The SDK never trusts the wire:
 * every value is checked (and strings bounded) before the UI or resolver sees it.
 */
import type {
  Citation,
  GuidanceResult,
  GuidanceStep,
  GuidanceStreamEvent,
  GuidanceTarget,
  MatchStrategy,
  PublicSdkConfig,
  SdkInitResponse,
} from '../../packages/contracts/src/sdk-types.ts';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 20000): v is string => typeof v === 'string' && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isStrOrNull = (v: unknown, max?: number): v is string | null => v === null || isStr(v, max);
const isStrArr = (v: unknown, max = 500): v is string[] =>
  Array.isArray(v) && v.length <= max && v.every((x) => isStr(x, 2000));

/** True when `v` is one of the space-separated words in `list`. */
const oneOf = (v: unknown, list: string): boolean => typeof v === 'string' && list.split(' ').includes(v);
const CATEGORIES = 'route pageTitle headings elements fieldLabels visibleErrors';
const ERROR_CODES = 'rate_limited invalid_request unauthorized provider_unavailable timeout internal';

export function isMatchStrategy(v: unknown): v is MatchStrategy {
  if (!isObj(v) || !isStr(v.value, 500) || v.value.trim() === '') return false;
  if (v.type === 'navoro_id') return true;
  if (v.type === 'aria_label' || v.type === 'text') return v.role === undefined || isStr(v.role, 64);
  return false;
}

export function isGuidanceTarget(v: unknown): v is GuidanceTarget {
  return (
    isObj(v) &&
    isStr(v.key, 200) &&
    isStr(v.label, 500) &&
    Array.isArray(v.strategies) &&
    v.strategies.length <= 10 &&
    v.strategies.every(isMatchStrategy) &&
    isNum(v.confidence) &&
    oneOf(v.validation, 'valid unverified uncertain')
  );
}

export function isGuidanceStep(v: unknown): v is GuidanceStep {
  return (
    isObj(v) &&
    isNum(v.index) &&
    isStr(v.title, 500) &&
    isStr(v.instruction, 4000) &&
    (v.target === null || isGuidanceTarget(v.target)) &&
    isStrOrNull(v.targetNote, 1000)
  );
}

function isCitation(v: unknown): v is Citation {
  return isObj(v) && isStr(v.sourceId, 200) && isStr(v.sourceTitle, 500) && isStr(v.excerpt, 4000);
}

export function isGuidanceResult(v: unknown): v is GuidanceResult {
  if (!isObj(v)) return false;
  const wf = v.workflow;
  const fb = v.fallback;
  return (
    isStr(v.sessionId, 200) &&
    isStr(v.requestId, 200) &&
    oneOf(v.kind, 'workflow answer troubleshooting unresolved') &&
    isStr(v.answer) &&
    isBool(v.grounded) &&
    isNum(v.confidence) &&
    (wf === null || (isObj(wf) && isStr(wf.id, 200) && isStr(wf.title, 500))) &&
    Array.isArray(v.steps) &&
    v.steps.length <= 50 &&
    v.steps.every(isGuidanceStep) &&
    Array.isArray(v.citations) &&
    v.citations.length <= 20 &&
    v.citations.every(isCitation) &&
    (v.mode === 'llm' || v.mode === 'demo' || v.mode === 'local') &&
    (fb === null || (isObj(fb) && isStr(fb.label, 500) && isStrOrNull(fb.url, 2000)))
  );
}

/** Validates one NDJSON line already parsed as JSON. */
export function parseStreamEvent(v: unknown): GuidanceStreamEvent | null {
  if (!isObj(v)) return null;
  if (v.type === 'status') {
    return oneOf(v.phase, 'retrieving reasoning validating') ? (v as GuidanceStreamEvent) : null;
  }
  if (v.type === 'result') return isGuidanceResult(v.result) ? (v as GuidanceStreamEvent) : null;
  if (v.type === 'error') {
    return oneOf(v.code, ERROR_CODES) && isStr(v.message, 2000) && isBool(v.retryable)
      ? (v as GuidanceStreamEvent)
      : null;
  }
  return null;
}

function isCategoryArr(v: unknown): boolean {
  return Array.isArray(v) && v.every((c) => oneOf(c, CATEGORIES));
}

export function isPublicSdkConfig(v: unknown): v is PublicSdkConfig {
  if (!isObj(v) || !isObj(v.privacy) || !isObj(v.launcher)) return false;
  const p = v.privacy;
  const l = v.launcher;
  return (
    isStr(v.applicationName, 200) &&
    (v.environment === 'development' || v.environment === 'production') &&
    isNum(v.configVersion) &&
    isCategoryArr(p.observe) &&
    isCategoryArr(p.transmit) &&
    isStrArr(p.blockedNavoroIds, 2000) &&
    isStrArr(p.blockedSelectors) &&
    isStrArr(p.approvedNavoroIds, 5000) &&
    p.allowlistOnly === true &&
    isBool(v.analyticsEnabled) &&
    isBool(v.discoveryEnabled) &&
    (l.position === 'bottom-right' || l.position === 'bottom-left') &&
    isStr(l.greeting, 1000) &&
    isStrArr(l.suggestions, 20) &&
    isStrOrNull(v.supportUrl, 2000)
  );
}

export function isSdkInitResponse(v: unknown): v is SdkInitResponse {
  return (
    isObj(v) &&
    v.apiVersion === 1 &&
    isStr(v.sessionToken, 8000) &&
    v.sessionToken.length > 0 &&
    isStr(v.expiresAt, 100) &&
    isPublicSdkConfig(v.config)
  );
}
