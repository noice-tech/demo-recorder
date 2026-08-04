# Agent-First Exploration and Direction

## Principle

Demo Recorder contains no embedded model client. A coding agent supplies semantic reasoning through normal repository and terminal tools. Runtime modules expose deterministic operations and durable JSON boundaries, so the same workflow can be used by Cursor, Pi, Claude Code, Codex, or another agent harness.

## Components

### Agent skill

`skills/demo-video` is the orchestration layer. It tells an agent when to inspect source, invoke browser exploration, request manual authentication, write a plan, validate safety, execute, render, and inspect output.

### Explorer

The CLI's `explorer` module provides:

- bounded same-origin Playwright surface mapping;
- persistent browser sessions across separate agent shell calls;
- AI-oriented ARIA snapshots, viewport screenshots, headings, layers, controls, and errors;
- observation-scoped element refs and durable locator candidates;
- runtime action policy, semantic diffs, and before/after state-transition evidence;
- append-only observation/transition journals and recoverable state graphs;
- agent-selected transition paths replayed and verified in a fresh browser context;
- agent-selected local process startup, readiness, logs, and cleanup;
- detached headed authentication sessions;
- cookies/local-storage and same-origin session-storage profiles.

For ordinary sites, one-shot exploration navigates discovered HTTP links directly while using the same semantic page/target collectors and persisting viewport screenshots and AI-oriented ARIA evidence. For SPA state, the agent uses `explore start`, inspects an observation, and proposes one bounded `explore act`. The action response includes a compact viewport-first summary of the resulting observation with fresh refs, while `explore current` retrieves that same summary without recapturing it; complete evidence remains in the referenced artifact and `explore observe` is reserved for UI that changed externally. Snapshot-backed search avoids loading the full observation. Ordinary directed work stays in one session with a small action budget, then verifies one selected connected path in a fresh context. Verification replays durable locator candidates, rejects ambiguous matches, and checks expected semantic fingerprints and URLs before `explore finish`. The default policy permits same-origin navigation and clearly presentational controls while blocking forms, destructive actions, external side effects, and unknown controls. Temporary refs expire when a new observation is authoritative and never enter verification paths.

### Planner

The CLI's `demo-plan` module is a protocol rather than an AI. It validates agent-authored `DemoPlan` documents, rejects default cross-origin and destructive steps, enforces read-only constraints, estimates duration, and produces a storyboard.

A passing verified interactive path is exported as the default planner handoff. The exporter uses the locator candidate actually proven in the clean replay, retains bounded fallbacks, and compiles observed URL and heading changes into ordinary assertions. Representable navigation, interaction, locator, scroll, and postcondition steps remain the verified core rather than being manually reconstructed. The coding agent remains the director for the brief, purposes, timing, beats, presentation, and any narrowly scoped interaction the exporter cannot represent. Manual plan authoring remains available when no verified interactive path exists.

Plans use accessible locator specifications with controlled fallbacks. Locator resolution requires exactly one visible match and never silently selects `.first()`. Generated TypeScript is unnecessary; the recorder executes validated JSON directly.

`plan rehearse` executes the validated plan in a fresh browser without video capture. It writes per-step timing and, on failure, the exact step, current URL, ARIA snapshot, screenshot, trace, and focused repair hints. `--fast` compresses editorial holds and scroll animation for functional preflight, but its report is marked `mode: "fast"` and `captureReady: false`; a full-speed passing rehearsal remains the capture-quality gate. Checkbox and radio actions target their visible associated labels so rehearsal and capture follow the surface a user clicks. The agent can make a targeted edit and use attempts 2 or 3; the runtime rejects later attempts. Final capture never invokes this repair workflow.

### Recorder and renderer

The CLI's `capture` module resolves plan locators and executes navigation, movement, click, fill, key, selection, scroll, visibility, URL, and hold steps. It stores the original plan and presentation direction beside immutable recording facts.

The CLI's `renderer` module continues to derive click zooms automatically. A validated `presentation.json` can provide explicit zoom segments, while the source WebM and manifest remain unchanged.

## Safe autonomy

Plans do not require an approval prompt. Instead, defaults are deliberately restrictive:

- same-origin navigation only;
- same-origin main-frame navigation enforcement in persistent exploration;
- no form submission during exploration;
- no destructive, external-side-effect, or unknown exploration actions by default;
- no fill, press, or selection in plans where `modifyData` is false;
- destructive locator names are rejected;
- explicit local start commands only;
- generated and authentication state ignored by Git.

If a requested story genuinely requires data mutation, the agent must encode that intent in the plan constraints. Persistent exploration remains `read-only` by default; an explicit `reversible` profile is limited to disposable local or staging state and still blocks destructive and external-side-effect controls. These policies reduce risk but cannot prove that arbitrary application code has no hidden server-side effect.

## Authentication lifecycle

`auth start` launches a detached local daemon and headed Chromium, then returns control to the agent. The user manually handles login, MFA, CAPTCHA, or consent. `auth save` contacts the loopback daemon using a random token, writes local JSON state with restricted permissions, and closes the browser. Tokens live only in ignored session descriptors.

The user must never be asked to paste credentials into the conversation. Authentication state is never included in exploration reports, plans, recordings, or rendered assets.

## Target environments

Normal plans can target:

- an external URL;
- an already-running local app;
- an app started from an explicit repository command;
- an optional authentication profile.

A test-only static fixture provides deterministic integration and package smoke coverage; it is not included in the published package.

## Current boundary

The agent writes plans; Demo Recorder does not convert natural language into a plan by itself. The `create` CLI command intentionally explains this boundary. The portable skill can be installed with `npx skills add noice-tech/demo-recorder` and, after explicit user consent, bootstraps the deterministic CLI through a pinned npm package. It requests separate consent before downloading Playwright Chromium. This convenience must not introduce hidden model calls into the runtime.
