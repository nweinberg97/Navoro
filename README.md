# navoro

**Less searching. More doing.**

Navoro is in-app help that **shows people how to do things**. A user types or says what they're trying to do; Navoro answers from your product's docs, **points at the exact control on screen** and walks them through it step by step, starting from wherever they already are. When it's something a guide can't fix (a billing problem, a bug, "I need a human"), it hands off to your support email with the question already filled in.

It runs **entirely in your users' browsers**: no server to host, works offline, and nothing about the user is ever sent anywhere. It can read the screen for context, but only what your privacy rules allow. It never clicks, types or submits for anyone.

- **Landing page:** https://nweinberg97.github.io/Navoro/
- **Download (prebuilt, no install):** https://github.com/nweinberg97/Navoro/releases/latest/download/navoro.zip

---

## Add it to any web app (no server)

**1. Describe your app** in a `navoro.config.json`:

```json
{
  "name": "Your App",
  "docs": ["docs/help"],
  "supportEmail": "support@yourapp.com",
  "privacy": {
    "neverCollect": [
      { "selector": ".card", "reason": "User content" },
      { "navoroId": "billing.payment", "reason": "Payment details" }
    ]
  }
}
```

`docs` takes Markdown/text files, folders, or public URLs. Help articles written as `## How to …` with numbered steps and **bold** button names become walkthroughs; `## Troubleshooting: <message> (CODE)` sections become error fixes; a `## Glossary` becomes term definitions. That's the shape most help centers already have.

**2. Build the knowledge pack** (a single static JSON file, typically 20–50 KB):

```bash
npm run navoro-pack -- path/to/navoro.config.json      # add --check in CI to fail when a step can't find its button
```

It prints a coverage report: which steps can point at a control, which can't and why, and which regions will never be read.

**3. Add one script tag** and serve both files from your own site:

```html
<script src="/navoro/navoro.js" data-navoro-pack="/navoro/navoro-pack.json" defer></script>
```

`navoro.js` is `dist/sdk/navoro.js` (68 KB, 24 KB gzipped, no dependencies). That's the whole install.

**Optional, but makes pointing reliable across redesigns:** add `data-navoro-id="reports.new"` to the controls your docs mention, and mark errors with `data-navoro-error="CODE"` so "what's wrong?" can explain them. Without an `elements` list in the config, any element you tag is allowed as context (tagging is the opt-in) and steps match controls by their accessible name or visible text.

### Your Help button, your colours

Navoro fits into the app instead of floating on top of it:

| Want | Do |
|---|---|
| Navoro's (?) icon in a spot you choose | `data-navoro-button=".menu-btn" data-navoro-button-placement="before"` on the script tag (`before`, `after`, `prepend`, `append`). It takes the surrounding text colour and comes back if your header re-renders. |
| Your own button opens Navoro | Add `data-navoro-trigger` to it (ship it with `hidden`; Navoro shows it once ready and keeps `aria-expanded` in sync). |
| Highlights in your brand colour | Automatic from `<meta name="theme-color">`; or `data-navoro-accent="#59b2ec"`, `data-navoro-accent="var(--brand)"`, or `"theme": { "accent": "#59b2ec" }` in navoro.config.json. Text on the accent switches between dark and light for contrast. |

With either button option the floating launcher is hidden and the panel opens next to your button.

### What it does with a question

| The user… | Navoro… |
|---|---|
| asks how to do something | answers in one line, then spotlights each control in turn ("Step 2 of 7"), advancing as they click. If they're already partway (e.g. on the form), it starts at the right step and says so. |
| is looking at an error and asks "what's wrong?" | explains that error from your docs and points at the field to fix. Errors on screen don't hijack unrelated questions. |
| asks something ambiguous ("how do I change it?") | picks the workflow whose controls are on the current screen. |
| asks something the docs don't cover | says so instead of guessing, and offers support. |
| needs a human (refund, bug, "talk to someone", "that didn't help") | hands off: **Email support** opens their mail app with the question and current page filled in, for them to review and send. "No" on any answer offers the same. |
| prefers to speak | taps the mic. Navoro only shows it where the browser recognises speech **on the device**; set `data-navoro-voice="any"` to also allow the browser's cloud speech service, or `"off"`. |

### Privacy, enforced in the browser

- Nothing is sent anywhere. The only requests are the two static files above, from your own origin. (Tested: the browser tests fail on any other request.)
- Navoro reads only what your rules allow: by default the page route, title, the labels and states of tagged controls, and errors you've marked. Never input values, never keystrokes, never screenshots.
- `neverCollect` regions (by `data-navoro-id` or CSS selector) are skipped entirely, and so is anything marked `data-navoro-sensitive`, plus built-in exclusions for passwords, one-time codes and payment fields.
- Users can open **What Navoro read on this page** in the panel to see exactly what it used.

Try it: run the demo (below) and open **http://localhost:4500/?navoroMode=local**. That's the Lumen app with the SDK and pack served by the app itself; no Navoro server involved.

### Hosted mode (optional)

The rest of this repo is an optional hosted tier for teams: a dashboard to manage docs and guidance without redeploying, Refresh Learning, analytics on what users ask, and optional model-generated answers. Same SDK, same knowledge format; use `data-navoro-key` instead of `data-navoro-pack`. Everything below describes running it.

---

## Run the hosted tier and demos in two minutes

You need **Node.js 22.18 or newer** (https://nodejs.org). Nothing else — Navoro has zero runtime dependencies and uses Node's built-in SQLite.

**From the download:**

```bash
unzip navoro.zip && cd navoro
node start.mjs
```

**From a git checkout:**

```bash
npm install          # dev tooling only (esbuild, TypeScript, Playwright, React)
npm run dev          # builds the browser bundles and starts the server
```

Either way you get:

| What | Where | Notes |
|---|---|---|
| Website + admin dashboard | http://localhost:4400 | Sign in with the seeded demo account **demo@navoro.dev / navoro-demo-2026** |
| Lumen Analytics demo app | http://localhost:4500 | A fictional SaaS product with the Navoro SDK installed, on a **separate origin** |
| SDK bundle | http://localhost:4400/sdk/v1/navoro.js | ~47 KB minified, framework-free |

The first start creates `.data/navoro.db`, seeds a synthetic **Lumen Labs** workspace, ingests the sample help center through the real pipeline, publishes the extracted workflows and a development configuration, and starts both servers.

### Enable a language model (optional)

Without a key Navoro runs in clearly labelled **demo mode**: answers are assembled directly from your retrieved documentation (BM25 retrieval + deterministic grounded composer). Every answer and the dashboard say so. To use a model:

```bash
ANTHROPIC_API_KEY=sk-ant-… node start.mjs       # or put it in a .env file next to start.mjs
```

The model receives only retrieved candidates plus the sanitized screen context, must answer through a validated structured tool call, and may only *choose* among stored workflows, errors and passages. It cannot invent steps, targets or selectors; those always come from the database and validated element mappings. See `docs/ARCHITECTURE.md`.

All settings are documented in `.env.example`.

---

## The end-to-end demo

1. Sign in at http://localhost:4400/login (or create your own workspace at `/signup` and follow the empty-state checklist).
2. **Applications → Lumen Analytics** shows the install snippet, environments, allowed origins, configuration versions and approved application metadata.
3. **Knowledge** shows the sample help center as *Ready*. Add your own: write a doc, paste an article, upload `.md`/`.txt`, import a public docs URL (try `http://localhost:4500/help/getting-started.md`) or a YouTube URL.
4. **Guidance** lists the extracted workflows ("Create a report", "Connect a data warehouse", …), troubleshooting rules, UI terms and element mappings. Edit a step, correct a mapping, publish drafts, and use **Preview** to see what end users will get.
5. **Refresh Learning** (top right) runs the real pipeline as a cancellable background job and reports what changed and what needs review.
6. **Privacy & Security** controls what the SDK may observe and transmit, never-collect rules, retention and the visual **Training Mode** (wireframes captured by the SDK in development — mark a region as sensitive, save, publish).
7. Open the demo at http://localhost:4500, click the launcher (bottom right) and ask *"How do I create a report?"*. Navoro highlights **Reports**, then **New report**, then each field — advancing as you use the app, or with Next/Back. Try *"Why can't I connect my warehouse?"* on Integrations after a failed test, or *"What does Schedule mean?"*.
8. The billing page (Settings → Billing) carries synthetic sensitive data ("Jordan Avery", a test card number). Open the panel's **Inspect payload** section in development to see that it never leaves the browser.
9. **Analytics** and **Overview** reflect the sessions you just created.

---

## Repository layout

```
server/            Node HTTP server (no framework), run directly from TypeScript
  api/             Route handlers: auth, admin, sdk (versioned public API)
  data/            Tenant-scoped repositories (the only place SQL lives)
  db/              SQLite wrapper + migrations/001_init.sql (tenant guard triggers)
  knowledge/       normalize → extract → mapping → fetchers → retrieve
  services/        ingestion, guidance (shared intelligence layer), publishing
  jobs/            Durable job runner + ingest/refresh handlers
  ai/              Provider abstraction + Anthropic implementation
  security/        scrypt, HMAC tokens, rate limiting, origin checks
  seed/            Sample Lumen help center + reproducible demo seed
  main.ts          Entry point;  app.ts  composition root;  demo-server.ts  Lumen origin
sdk/src/           Embeddable SDK (framework-free, zero deps, shadow DOM)
web/src/site       Public website     web/src/app  Admin dashboard (React)    web/src/ui  shared components
demo/              Lumen Analytics — the fictional customer app
packages/contracts Versioned SDK⇄backend and admin API types, knowledge pack format
packages/engine    On-device guidance engine (retrieval, answers, hand-off, start-where-you-are)
tests/             unit (node:test), integration (real server), e2e (Playwright + Chromium)
scripts/           navoro-pack, build, build-pages, package-release, lint, migrate, seed
start.mjs          Launcher used by the downloadable release
docs/              ARCHITECTURE.md · SECURITY.md · REFERENCE_AUDIT.md
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Build bundles and start the server (+ demo app) |
| `npm start` | Start the server without rebuilding |
| `npm run build` | Build site, dashboard, SDK and demo bundles into `dist/` |
| `npm run navoro-pack -- <config>` | Build an offline knowledge pack from a navoro.config.json (`--check` fails on unpointable steps) |
| `npm run typecheck` | TypeScript across server, web, SDK and browser tests |
| `npm run lint` | Security-invariant checks (tenant scoping, no eval/innerHTML, no secrets, SDK read-only) |
| `npm test` | Unit + integration tests (unit tests include real-Chromium SDK tests) |
| `npm run test:e2e` | Browser tests of the complete admin + end-user journey |
| `npm run check` | typecheck + lint + build + test |
| `npm run db:migrate` / `db:seed` / `db:reset` | Migrations and the reproducible demo workspace |
| `npm run release` | Minified build + `release/navoro.zip` (what the Download button serves) |
| `npm run build:pages` | Static landing page for GitHub Pages |

CI (`.github/workflows/ci.yml`) runs typecheck, lint, build, unit, integration and e2e on every push. `release.yml` rebuilds the zip and updates the rolling `latest` release; `pages.yml` deploys the landing page.

## Tests

Last full run in this repository: **153 unit, 107 integration, 10 end-to-end — all passing** (`npm test && npm run test:e2e`). Highlights:

- Tenant isolation at the API *and* database layer (cross-tenant inserts rejected by triggers), SDK tokens bound to app + environment + origin.
- Privacy Blinders: synthetic card numbers, passwords, blocked regions and API tokens never appear in any outbound SDK request.
- Invalid mappings fail safely (no arbitrary highlight; explanation + `step_target_missing` event).
- Refresh Learning reports changes, flags broken mappings, moves dependent published workflows to review, honours the approval policy, and cancels.
- Provider failures fall back to grounded demo-mode answers and are recorded in usage.
- Keyboard access, reduced motion, CSP compatibility, responsive layouts.

## Installing the SDK in your own app

```html
<script src="https://YOUR-NAVORO-ORIGIN/sdk/v1/navoro.js"
        data-navoro-key="nav_pk_…"      <!-- identifier, not a secret -->
        data-navoro-env="production"
        defer></script>

<button data-navoro-id="reports.new">New report</button>
```

Register your app's origin in **Applications**, add `data-navoro-id` attributes to controls you want Navoro to point at, approve them under *Approved application metadata* (the SDK discovers them automatically in development), and publish a configuration. The SDK validates the origin on init, loads only the published public configuration, and collects only allowlisted context. `window.Navoro` also exposes `init`, `open`, `close`, `ask`, `destroy`, `on('state')` and (development only) `getLastPayload()`.

**Use your own Help button** instead of the floating launcher: add `data-navoro-launcher="hidden" data-navoro-panel="top-right" data-navoro-panel-offset="64"` (offset = your header height + a gap), then call `Navoro.open()` / `Navoro.close()` / `Navoro.isOpen()` from your button and keep its `aria-expanded` in sync with `Navoro.on('panel', open => …)`. Focus returns to your button when the panel closes. Sedi does exactly this (`js/navoro.js`).

Recommended host CSP: `script-src 'self' https://YOUR-NAVORO-ORIGIN; connect-src 'self' https://YOUR-NAVORO-ORIGIN`. Navoro uses constructable stylesheets inside a shadow root, so no `'unsafe-inline'` is needed.

## Limitations and what is not claimed

- **Single-node deployment.** SQLite, an in-process job worker and in-memory rate limits are right for evaluation and small deployments; a multi-instance deployment needs Postgres (the data layer is already tenant-scoped and migration-driven), a shared queue and a shared rate-limit store. See `docs/ARCHITECTURE.md`.
- **Retrieval is lexical (BM25).** Good for per-application help centers; no embeddings/vector index yet.
- **Extraction is structural.** Workflows are recognised from headings + numbered steps with **bold** UI labels (the pattern of most help centers). Unstructured prose is still searchable but produces no workflows; the dashboard tells you so.
- **YouTube** import works only for videos with publicly accessible captions.
- **No email delivery** (member invites set an initial password), no SSO, no password reset flow.
- **Not a compliance claim.** Privacy controls are implemented and tested, but no SOC 2 / GDPR / HIPAA certification is claimed. Remaining gaps are listed honestly in `docs/SECURITY.md`.
- **Read-only SDK.** Action-taking is deliberately out of scope and would need its own security design.
