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

`apps/cli/src/explorer` owns bounded Playwright exploration, persistent agent-directed browser sessions, ARIA snapshots, screenshots, observation-scoped control refs, conservative state/transition graphs, generic repository facts, managed local app processes, and local auth profiles.

The one-shot mapper follows ordinary links. Persistent sessions expose an `observe → one bounded action → observe` protocol so an agent can inspect tabs, menus, dialogs, drawers, and other same-URL state. Every accepted action records policy and before/after evidence. Temporary refs are valid only for their observation; durable role/test-ID/text/CSS target recipes are stored with transitions.

Exploration is same-origin and uses a conservative `read-only` policy by default. Destructive, external-side-effect, form, and unknown controls are blocked; an explicit `reversible` profile can permit mutation-like controls in disposable environments. These are runtime guardrails rather than a guarantee that arbitrary application code has no server-side effects. Repository reports include environment-variable names but never secret values.

## 3. Planner protocol

`apps/cli/src/demo-plan` owns the versioned `DemoBrief`, locator, action, presentation, and `DemoPlan` schemas. It validates origin and safety constraints, estimates duration, and renders storyboards. It contains no semantic model: the coding agent authors the plan.

Declarative JSON is the default execution format because it is inspectable, schema validated, portable, and safer than arbitrary generated code.

## 4. Target environments

A plan can point to an external URL, an existing local server, or an agent-selected managed process. Managed commands have explicit working directories, readiness URLs, captured logs, and guaranteed shutdown. Tests use an isolated local fixture that is never included in the published package.

## 5. Authentication

A detached loopback auth session opens headed Chromium while returning conversational control to the agent. After manual login/MFA/CAPTCHA, the daemon saves Playwright cookies and local storage plus same-origin session storage as ignored local JSON. Profiles are passed into exploration and recording contexts and never enter plans or captures.

## 6. Recorder

`apps/cli/src/capture` owns Chromium video capture, the shared relative clock, interaction instrumentation, plan locator resolution, plan execution, media inspection, and finalization. Instrumented navigation, movement, click, fill, key, selection, scroll, visibility, URL, and hold actions execute a validated plan.

The recorder executes validated plan actions through instrumented Playwright helpers so cursor and semantic metadata remain synchronized. Incomplete recording directories are removed on failure.

## 7. Recording format

A recording directory contains immutable `recording.json` capture facts and `browser.webm`. Agent-authored `demo-plan.json` and `presentation.json` are separate inputs. This preserves the recording boundary: changing direction never rewrites what Playwright captured.

## 8. Timeline processing

`packages/core` contains framework-independent schemas and pure calculations. It clusters clicks, derives zooms, interpolates cursors, projects viewport coordinates, and computes camera state.

The renderer uses automatic click zooms unless a validated presentation file provides explicit viewport/timeline-safe zoom segments.

## 9. Composition

`apps/remotion` is the only React application. `ProductDemo` renders the browser frame, source WebM, synthetic cursor, click feedback, and one shared camera transform. Video and overlays use core's coordinate projection.

## 10. Renderer

`apps/cli/src/renderer` validates recording and presentation paths, serves the original WebM through an exact loopback URL, loads the packaged prebuilt Remotion composition, and renders H.264 MP4 with Playwright's Chromium executable. It never changes source media and cleans servers and partial output on failure.

## Dependency direction

```text
core ← cli capture + renderer
core ← remotion
demo-plan ← cli capture + renderer
explorer + capture + renderer ← CLI commands
agent skill → CLI commands
```

`packages/core` is the only private implementation package and has no Playwright, React, or Remotion dependency. Node-only exploration, planning, capture, and rendering remain separate source modules inside `apps/cli` rather than separate workspaces. React remains confined to `apps/remotion`.
