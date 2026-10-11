# Reference audit: farzaa/clicky

Inspected on 2026-10-10 (shallow clone of https://github.com/farzaa/clicky, MIT). Files read: `README.md`, `AGENTS.md`/`CLAUDE.md` (architecture notes, key-file table, decisions), `worker/src/index.ts` (Cloudflare proxy), and the state and `[POINT:…]` prompt/parsing portions of `leanring-buddy/CompanionManager.swift`. `OverlayWindow.swift` and `ElementLocationDetector.swift` are known through the repository's own architecture notes, not inspected line by line. Clicky is a macOS menu-bar voice companion: push-to-talk → screenshot → Claude → TTS, with a cursor overlay that flies to `[POINT:x,y:label]` coordinates the model embeds in prose.

## What transferred to Navoro (as ideas, re-implemented for the web)

| Clicky pattern | Navoro equivalent |
|---|---|
| One central state owner (`CompanionManager`, `voiceState` enum) coordinating the whole pipeline | `SessionMachine` with an explicit transition table and request ids; `NavoroController` as the single coordinator |
| All provider keys on a server-side proxy; the client never calls Anthropic | `ModelProvider` behind `/api/sdk/v1/guidance`; the SDK has no credentials at all, only an origin-bound token |
| Full-screen non-activating overlay that never steals focus | Shadow-DOM overlay root with `pointer-events: none` spotlight; focus only moves between Navoro's own controls |
| A tiny core interaction makes a complex AI product feel simple | One launcher, one question box, one step card |
| Architecture documented for AI-assisted development (key-file table, decisions) | `docs/ARCHITECTURE.md`, `README.md` layout table, doc comments on every module's public surface |
| Cancellation of pending work on key release / state change | AbortController + stale-result rejection + Escape semantics |

## What was deliberately **not** copied

- **Coordinates from prose.** Clicky asks the model for pixel coordinates inside the answer text. Navoro never derives targets from model output; targets come from stored, validated element mappings keyed by `data-navoro-id`, accessible name or text, resolved against live DOM geometry.
- **Screenshots and whole-screen capture.** Navoro's context collector is allowlist-first and structural; no pixels, no DOM dumps.
- **Desktop-specific plumbing** (NSPanel, CGEvent taps, ScreenCaptureKit, TTS/STT providers) — irrelevant to a browser SDK.
- **Branding, UI, copy, assets, or code.** Nothing from the repository was reused; Navoro is an independent implementation with its own identity, data model and SDK architecture.

## Lessons about failure handling

Clicky's notes on a shared long-lived `URLSession` (per-session sessions corrupted the connection pool) informed Navoro's single `NavoroApi` client per init with token refresh, and its transient-overlay auto-hide informed the "lost target → explain + Find it again" behaviour instead of pointing at nothing.
