# Demo Recorder Architecture

Demo Recorder separates agent reasoning, application exploration, browser capture, and media presentation. The host coding agent acts as explorer/director; Demo Recorder itself makes no model API calls.

```text
User brief → Coding agent + skill
                    ↓
     Repository tools + Explorer
                    ↓
          Validated DemoPlan
                    ↓
       Recorder → recording.json + browser.webm
                    ↓
            Timeline Processing
                    ↓
       Composition ← Renderer → MP4
```

## 1. Agent skill

`skills/demo-video` is a portable Agent Skills workflow for Pi, Claude Code, Codex, and similar terminal-capable agents. It teaches source inspection, safe browser exploration, auth handoff, directorial planning, execution, rendering, and output inspection. Runtime modules remain deterministic and provider-neutral.

## 2. Explorer

`apps/cli/src/explorer` owns bounded Playwright exploration, persistent agent-directed browser sessions, ARIA snapshots, screenshots, observation-scoped control refs, conservative state/transition graphs, managed local app processes, and local auth profiles.

The one-shot mapper follows ordinary links. Persistent sessions expose an `observe → one bounded action → resulting observation` protocol so an agent can inspect tabs, menus, dialogs, drawers, and other same-URL state without a redundant recapture. `explore current` returns the authoritative observation already in memory. Target collection batches DOM facts, prioritizes viewport controls for browser-derived accessible identity, and defers locator uniqueness checks until replay. Every accepted action records policy, an explicit semantic diff, and before/after evidence in append-only journals and an atomically materialized graph. Temporary refs are valid only for their observation; durable role/test-ID/text/CSS target recipes are stored with transitions.

An agent can select a connected sequence of successful transition IDs and invoke `explore verify`. Verification starts a fresh authenticated context, reproduces the initial state, resolves each durable candidate only when it uniquely identifies a visible element, replays the bounded action, and checks the expected semantic fingerprint and sanitized URL. Reports, step screenshots, and a separate Playwright trace remain exploration evidence; verification does not improvise or reuse temporary refs. Main-frame locators pierce open shadow roots through Playwright's public locator behavior. Cross-origin and child-frame controls are intentionally not assigned main-frame refs in this version; agents can observe the iframe boundary but must treat frame-specific interaction as unsupported rather than guessing.

Exploration is same-origin and uses a conservative `read-only` policy by default. Destructive, external-side-effect, form, and unknown controls are blocked; an explicit `reversible` profile can permit mutation-like controls in disposable environments. These are runtime guardrails rather than a guarantee that arbitrary application code has no server-side effects.

## 3. Planner protocol

`apps/cli/src/demo-plan` owns the versioned `DemoBrief`, locator, action, presentation, and `DemoPlan` schemas. It validates origin and safety constraints, estimates duration, and renders storyboards. A passing verified path can be exported as a draft plan using the locator candidate proven during replay and ordinary URL/visibility assertions as postconditions. It contains no semantic model: the coding agent remains responsible for editorial planning.

`plan rehearse` executes the deterministic plan without video capture and produces bounded failure evidence for up to three agent-directed repair attempts. Final recording contains no explorer or repair fallback. Declarative JSON is the default execution format because it is inspectable, schema validated, portable, and safer than arbitrary generated code.

## 4. Target environments

A plan can point to an external URL, an existing local server, or an agent-selected managed process. Managed commands have explicit working directories, readiness URLs, captured logs, and guaranteed shutdown. Tests use an isolated local fixture that is never included in the published package.

## 5. Authentication

A detached loopback auth session opens headed Chromium while returning conversational control to the agent. After manual login/MFA/CAPTCHA, the daemon saves Playwright cookies and local storage plus same-origin session storage as ignored local JSON. Profiles are passed into exploration and recording contexts and never enter plans or captures.

## 6. Recorder

`apps/cli/src/capture` owns Chromium video capture, the shared relative clock, interaction instrumentation, plan locator resolution, plan execution, media inspection, and finalization. Instrumented navigation, movement, click, fill, key, selection, scroll, visibility, URL, and hold actions execute a validated plan. Scroll actions use cross-platform, 60 Hz wheel gestures with brief acceleration and a longer momentum decay; rehearsal and exploration share the same implementation.

The recorder executes validated plan actions through instrumented Playwright helpers so cursor and semantic metadata remain synchronized. Locator candidates must resolve to exactly one element; ambiguous matches are errors rather than implicit first-element selection. Incomplete recording directories are removed on failure.

## 7. Recording format

A recording directory contains immutable `recording.json` capture facts and `browser.webm`. Agent-authored `demo-plan.json` and `presentation.json` are separate inputs. This preserves the recording boundary: changing direction never rewrites what Playwright captured.

## 8. Timeline processing

`packages/core` contains framework-independent schemas and pure calculations. It clusters clicks, derives zooms, interpolates cursors, projects viewport coordinates, and computes camera state.

The renderer uses automatic click zooms unless a validated presentation file provides explicit viewport/timeline-safe zoom segments.

## 9. Composition

`packages/ffmpeg-renderer` builds a single FFmpeg filter graph for the browser frame, source WebM, synthetic cursor, click feedback, bundled Inter title, and shared camera transform. Timed overlays are generated from frame-sampled core timeline data and transformed with the video.

## 10. Renderer

`apps/cli/src/renderer` validates recording and presentation paths, prepares immutable capture inputs, and delegates to the FFmpeg renderer. The renderer probes user-installed FFmpeg and ffprobe capabilities, invokes `libx264` directly, reports progress, and removes partial output after failures or interruption. It never changes source media or starts a media server.

## Dependency direction

```text
core ← cli capture + ffmpeg renderer
ffmpeg renderer ← cli renderer
demo-plan ← cli capture + renderer
explorer + capture + renderer ← CLI commands
agent skill → CLI commands
```

`packages/core` contains framework-independent contracts and pure timeline logic. `packages/ffmpeg-renderer` is the private media implementation package and depends on core, while Node-only exploration, planning, capture, and orchestration remain source modules inside `apps/cli`. Rendering has no browser or React dependency.
