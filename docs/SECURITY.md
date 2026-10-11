# Security & privacy: threat model, controls, gaps

This document describes what Navoro implements and tests, and what it does not. **No SOC 2, GDPR, HIPAA or other certification is claimed.**

## Trust boundaries

- **Browser of an end user** (customer's app + Navoro SDK): untrusted. May be hostile, may be on a hostile page.
- **Navoro server**: trusted; holds all secrets.
- **Documentation sources and model output**: untrusted *data*.
- **Dashboard admins**: authenticated tenants; least privilege by role.

## Threats and controls

| Threat | Controls | Tests |
|---|---|---|
| **Cross-tenant data leakage** | `org_id` on every table; repositories bind it into every statement; handlers cannot touch the raw DB (lint); `BEFORE INSERT` triggers reject rows whose `org_id` disagrees with the parent; same 404 for "missing" and "other tenant"; SDK tokens bound to `{app, org, env, origin}`; events referencing another tenant's session are dropped. | `tenant-isolation`, `sdk`, `analytics` |
| **Malicious / compromised documentation, prompt injection** | Docs are text data, never rendered as HTML (`htmlToText` strips scripts, decodes entities). Model prompt wraps candidates in delimiters with `<` escaped and instructs the model to ignore instructions in them; output must be a validated tool call that only *selects* candidate ids. Answers are plain text rendered via `textContent`. | `server-guidance`, `server-knowledge`, `sdk-dom` |
| **Untrusted model-generated selectors** | The model cannot emit targets. Targets come only from stored mappings with provenance/validation; the SDK matches by `data-navoro-id` (CSS.escape), accessible name or text — never by executing arbitrary selectors or code. Broken mappings return no target plus an explanation. | `sdk-resilience`, `server-mapping-privacy` |
| **Sensitive content leaving the browser** | Allowlist-first collector builds the payload from permitted fields (no serialize-then-redact). Built-in exclusions for password/OTP/payment inputs, `data-navoro-sensitive/ignore`, secret-looking names; admin never-collect rules by id/selector; input values/placeholders/keystrokes never read; server re-applies the published policy; question text retained only when opted in, with expiry sweep; events carry no free text. Development-only payload inspector. | `sdk-privacy`, `sdk-dom`, `analytics`, `server-mapping-privacy` |
| **Unauthorized SDK configuration changes** | Public key is an identifier only; SDK endpoints can only read the public projection of a *published* configuration and write events/discovery (dev only, policy-gated). All mutation requires an admin session + CSRF + role. | `sdk`, `roles`, `auth` |
| **Cross-site scripting** | No `innerHTML` with data (lint-enforced; one audited constant-SVG helper), no `dangerouslySetInnerHTML`, strict CSP on dashboard (`script-src 'self'`, `frame-ancestors 'none'`) and a reference strict CSP on the demo (no `unsafe-inline`; SDK uses constructable stylesheets). `javascript:` fallback URLs are not linked. | `sdk-dom`, `dashboard-a11y` (CSP violations fail tests) |
| **CSRF / session attacks** | HttpOnly, SameSite=Lax cookies (Secure on https); opaque session tokens hashed at rest; per-session CSRF token required on every mutation; Origin checked when present; scrypt password hashing with constant-time compare and a dummy hash for unknown users. | `auth` |
| **Abuse of public endpoints / DoS / AI cost** | Token-bucket limits per IP for init/login/signup, per app and per IP for guidance, per org for model calls; body size limits; request/headers timeouts; model timeouts with bounded retries; usage recorded per call. | `auth`, `server-security`, `server-provider` |
| **SSRF via URL import** | http(s) only, no credentials, raw private IP literals and DNS answers in private/loopback/link-local ranges refused (checked inside the socket `lookup` hook so the checked address is the one connected to), redirects re-validated (max 3), 2 MB / 10 s limits, text content types only. `NAVORO_ALLOW_PRIVATE_URLS` exists for the local demo and is refused in production. | `server-security`, `knowledge` |
| **Secrets in client code or logs** | Provider key only in server env; validated at startup; `.env` gitignored with a safe `.env.example`; structured logs with redaction of keys, bearer tokens, cookies; provider error bodies are never echoed to clients. | `lint`, `server-security` |
| **Origin spoofing / CORS confusion** | CORS headers emitted only for registered origins and only as a browser hint; the server independently rejects requests whose `Origin` is unregistered or does not match the token. Preflight responds 403 for unknown origins. | `sdk` |

## Retention defaults

- Question text: **not stored** unless the application's published policy enables it; then deleted after `retentionDays` by the hourly sweep.
- Page context: never stored. Only derived topic, outcome, grounded/confidence and structured events.
- Blueprints (Training Mode): structure only (ids, roles, labels, rectangles); labels of admin-blocked ids are nulled before storage.
- Audit log: admin actions with summaries, no end-user content.

## Known gaps (honest list)

- Rate limits and the job queue are in-memory/in-process: fine for one node, not for a fleet.
- No password reset, email verification, MFA or SSO. Member invites set an initial password out of band.
- SQLite triggers emulate RLS; a Postgres deployment should add real RLS policies in addition to the repository scoping.
- No encryption at rest beyond what the host filesystem provides; back up `.data/` accordingly.
- The admin "selector" never-collect rule accepts any syntactically plausible selector; invalid selectors are ignored by the SDK rather than rejected at save time beyond a character allowlist.
- Dependency supply chain: the server has none at runtime; dev dependencies (esbuild, TypeScript, Playwright, React) are pinned but not lock-filed in this repository.
- CSP for the dashboard allows `style-src 'unsafe-inline'` because React sets inline style attributes; scripts remain `'self'` only.
