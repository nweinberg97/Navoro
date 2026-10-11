# Navoro architecture

## Decisions in one page

| Decision | Choice | Why |
|---|---|---|
| Runtime | Node ≥ 22.18, TypeScript run via type stripping, **zero runtime dependencies** | The product must download and run with one command. No build step or native addon for the server; browser bundles are prebuilt. |
| Database | SQLite via `node:sqlite`, SQL migrations, tenant guard triggers | Durable, transactional, no install. The data layer is repository-based and migration-driven so Postgres can replace it without touching handlers. |
| HTTP | `node:http` + a 100-line router | No framework to audit or update; the request/response surface is small and explicit. |
| Validation | `server/lib/validate.ts` (strict objects, unknown keys rejected) | Every inbound payload — admin or SDK — is parsed before use; the model's structured output goes through the same validator. |
| Front-end | React 19 for website + dashboard, bundled by esbuild; **no router/UI/chart libraries** | Small, inspectable surface; design tokens in CSS custom properties. |
| SDK | Framework-free TypeScript IIFE, shadow DOM, constructable stylesheets, ~47 KB | Must not depend on dashboard internals, must coexist with any host CSS/CSP, must be independently embeddable. |
| AI | Server-side `ModelProvider` interface, Anthropic implementation, forced tool-use for structured output | Provider-swappable; model output is data to validate, never prose to parse into instructions. |
| Jobs | Durable rows in SQLite + in-process worker with step-level progress and cancellation | Refresh Learning is observable, cancellable and survives restarts (interrupted jobs are marked failed, not silently resumed). |
| Retrieval | In-process BM25 with light stemming over chunks + structured objects | No external index for per-app corpora; interface allows a vector index later. |

## Local mode (no server)

The primary install. `navoro-pack` (scripts/navoro-pack.ts → server/knowledge/pack-builder.ts) runs the same extraction and element-mapping code as the hosted pipeline at build time and writes a static **knowledge pack** (format in packages/contracts/src/sdk-types.ts). The SDK loads it from the app's own origin and answers with **packages/engine**, a pure, synchronous port of the grounded composer:

- retrieval: the same BM25 as the server (the server now imports it from the engine);
- context: visible error codes select troubleshooting rules (only for problem-type or vague questions, so on-screen errors don't hijack unrelated ones); workflows whose controls are on screen rank higher;
- hand-off: an intent check routes refunds, bugs, "talk to a human", "that didn't help" to a pre-filled `mailto:` the user reviews; every answer carries the contact so "No" can surface it;
- start-where-you-are (`chooseStartStep`): resolves each step's target against the live DOM and starts at the step the user has reached;
- `validatePack` treats the fetched pack as untrusted input (shape and size limits).

Privacy rules travel in the pack and feed the same collector and blinders as hosted mode; `approvedNavoroIds: ['*']` (no element list) means "any element the developer tagged". No events, discovery or questions leave the page. Voice uses the browser's SpeechRecognition only where it reports on-device processing, unless the app opts into cloud recognition; the probe is lazy (first panel open) and skipped under automation, because probing a browser without a speech service can crash the tab.

## Topology

```
┌──────────────── Navoro origin (localhost:4400) ────────────────┐   ┌── Customer app origin (localhost:4500) ──┐
│ website /        dashboard /app/*       GET /sdk/v1/navoro.js  │   │  Lumen Analytics (fictional SaaS)         │
│ /api/auth/*  /api/admin/*  (session cookie + CSRF)             │◄──│  <script src=…/sdk/v1/navoro.js           │
│ /api/sdk/v1/{init,guidance,events,discovery} (origin + token)  │   │          data-navoro-key=… defer>         │
│ SQLite ─ job worker ─ ModelProvider (Anthropic | none)         │   │  data-navoro-id="reports.new-button" …    │
└────────────────────────────────────────────────────────────────┘   └───────────────────────────────────────────┘
```

The demo app is served on a **different origin** on purpose: the SDK is exercised exactly as a real customer install (CORS preflight, origin validation, strict host CSP without `unsafe-inline`).

## Domain model (`server/db/migrations/001_init.sql`)

`users` · `organizations` · `memberships` (owner/admin/member) · `sessions` · `applications` (public key = identifier) · `environments` (development/production, allowed origins, active config version) · `config_versions` (immutable snapshots) · `element_catalog` (approved application metadata, discovered or imported) · `page_blueprints` (structural wireframes for Training Mode) · `privacy_policies` (draft) · `knowledge_sources` (original content + hash + status + provenance) · `knowledge_chunks` · `knowledge_items` (feature / ui_concept / known_error / troubleshooting) · `element_mappings` (strategies, provenance, confidence, validation) · `workflows` · `workflow_steps` · `guidance_sessions` · `questions` (text only when retention is on, with expiry) · `analytics_events` (no free text) · `audit_events` · `jobs` · `ai_usage`.

Every tenant-owned table carries `org_id`. `BEFORE INSERT` triggers reject any child row whose `org_id` disagrees with its parent's, and `org_id` is immutable. This is the SQLite equivalent of row-level security and is tested directly (`tests/integration/tenant-isolation.test.ts`).

## Request flow

**Dashboard:** cookie session (opaque token, hashed at rest, 7 days) → `requireSession` resolves the org → `tenant(db, orgId)` returns repositories that bind `org_id` into every statement → role check → validated body → handler. Mutations require the per-session `x-navoro-csrf` header and a same-origin `Origin` when present. Handlers never touch the raw DB (enforced by `npm run lint`).

**SDK:**
1. `POST /api/sdk/v1/init` — public key identifies the app; the request `Origin` must be registered for the environment; otherwise 403 with no key-existence oracle. Issues a 15-minute HMAC token bound to `{app, org, env, origin}` and returns the **public projection** of the active configuration version.
2. `POST /guidance` — token + matching origin required; rate limited per app and per IP. Streams NDJSON `status` events then one `result`. Server re-applies the published privacy policy to the context (defence in depth), retrieves, decides, validates, records a session (and the question text only if retention is enabled).
3. `POST /events` — structured events only (type, step index, mapping key, session id). Never question text.
4. `POST /discovery` — development only, policy-gated; stores page blueprints and unapproved catalog entries. Labels of admin-blocked ids are nulled before storage.

## Knowledge pipeline (`server/knowledge`, `server/services/ingestion.ts`)

`fetch (URL/YouTube, SSRF-guarded)` → `normalizeText` → `contentHash` → `extractKnowledge` (sections → chunks; `## How to…` + numbered steps → workflows; `Prerequisites:` → prerequisites; `## Troubleshooting: … (CODE)` → known errors with resolution; `## Glossary` → UI concepts; `## Feature:` → features; **bold** labels → UI label hints) → `resolveLabel` against approved metadata → mappings with provenance/confidence/validation → `upsertExtracted` (never clobbers admin edits; changed published workflows go to *needs review*) → source status `ready` / `needs_attention` / `failed` with the reason.

Reprocessing is idempotent: unchanged content hashes are skipped, and extracted workflow hashes decide `added / updated / unchanged / needs_review`.

## Shared intelligence layer (`server/services/guidance.ts`)

All three pillars go through `generateGuidance`:

1. `enforceContextPolicy` — only transmit ∩ observe categories; only approved, non-blocked elements; truncation.
2. `retrieve` — BM25 over live workflows, known errors (plus errors matched by the visible error *code* in context), UI concepts, features and chunks.
3. Decide — with a provider: structured tool call constrained to candidate ids (system prompt treats docs as untrusted; prompt wraps data in delimiters and escapes `<`). Output is validated; unknown ids or unsupported answers are rejected. Without a provider, or on any provider failure: `composeDeterministic` (grounded, labelled `mode: 'demo'`).
4. Build — steps come from `workflow_steps`; targets from `element_mappings` (broken mappings yield `target: null` + a note, never a guess). Answers are plain text; the SDK renders with `textContent`.
5. Honesty — `grounded`, `confidence`, citations with excerpts, and a `fallback` (support link / admin) when unresolved or low-confidence.

## Element mapping hierarchy (`server/knowledge/mapping.ts`, `sdk/src/resolver.ts`)

1. `data-navoro-id` (developer-provided, stable) — via `CSS.escape` on an attribute value only.
2. Accessible name (+ role).
3. Visible text (+ role), exact then prefix; ambiguity (>1 match) counts as *not found*.

No CSS selectors are generated by the model or accepted from it. Validation states: `valid` / `unverified` / `uncertain` / `broken`; Refresh Learning revalidates all mappings against the current catalog and flags workflows that depend on broken ones.

## SDK (`sdk/src`)

- **State machine** (`state-machine.ts`): idle → opening → collecting_context → requesting → streaming → resolving_targets → showing_guidance → completed, plus cancelled/error; explicit transition table, request ids reject stale results, invalid transitions are no-ops.
- **Context collector** (`context-collector.ts`): builds the payload from allowlisted fields; never reads values, placeholders or keystrokes; Privacy Blinders for password/credential/payment inputs, `data-navoro-sensitive`, admin-blocked ids/selectors and anything inside Navoro's own root. On demand only — no MutationObserver for collection.
- **Overlay** (`overlay.ts`): open shadow root, `pointer-events: none` spotlight, viewport-aware step card, scroll/resize/ResizeObserver tracking, scoped MutationObserver only while a target is highlighted, "lost target" recovery, reduced-motion aware.
- **Follow-along** (`controller.ts`): while a step is highlighted, a passive listener on that one element advances the walkthrough when the user activates it. Navoro never acts; it only notices.
- **Networking** (`api.ts`): fetch + AbortController, 15 s timeout, NDJSON streaming, token refresh, batched events with keepalive on `pagehide`.

## Publishing

`buildSnapshot` freezes the privacy draft, the ids of published workflows, approved navoro ids and launcher settings into `config_versions`; the environment's `active_config_version_id` points at it. `/init` serves the public projection. Before anything is published, the SDK runs with a conservative default policy and no workflows.

## Scaling path (not implemented)

Postgres with RLS policies mirroring the triggers · `SELECT … FOR UPDATE SKIP LOCKED` job claiming or an external queue · shared rate-limit store · embeddings behind `retrieve.ts` · streaming model tokens (today the model call is non-streaming; the SDK streams phases).
