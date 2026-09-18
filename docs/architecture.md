# Demo Recorder Architecture

Demo Recorder separates agent reasoning, browser control, capture, and media
presentation. The host coding agent is the explorer and director. The tool makes
no model API calls.

```text
brief → agent + skill
          ↓
   drivers + session (observe / act)
          ↓
        plan.json
          ↓
        plan rehearse (fresh browser)
          ↓
   record → browser.mp4 + events.json
          ↓
   render → output.mp4
```

The full interface contract is [contract.md](contract.md). This file is the short
technical overview.

## Layers

### Agent skill

`skills/demo-video` teaches an agent to inspect source, explore safely, handle
login, write a plan, verify, record, render, and inspect the result. Runtime
behavior stays deterministic and provider-neutral.

### Browser drivers

The CLI talks to a **driver**, not to Playwright directly. A driver either
launches a browser the tool owns or attaches to a browser the user already has,
such as their own Chrome. Every driver declares capabilities: `launch`, `attach`,
`ownLifecycle`, `isolatedContext`, `listPages`, `authState`, `capture`, and
`guarded`. The tool refuses a request a driver cannot satisfy and never closes a
browser it does not own. In 0.2.0, launched Chromium supports capture; attached
CDP supports exploration only. `explore pages --driver cdp --target URL` discovers
tabs before a session starts. Playwriter extension recording remains deferred.

### Session and observation

A live explore session keeps one browser between commands so same-page state
(tabs, menus, dialogs, drawers) survives. Each command observes the page,
performs one bounded action, and returns the resulting observation. Elements get
temporary `ref`s; durable `target` recipes are what plans use. Observations are
plain files, not a graph.

### Plan

A plan is versioned JSON: brief, target, viewport, constraints, and ordered
steps. Steps use durable targets and may carry an `expect` block. Waiting and
checking are part of `expect`; there are no separate assertion step types.

### Rehearse

`plan rehearse` runs the plan from a clean, isolated browser and checks every
`expect`. It proves the plan completed in that context with those expectations. It does not prove safety, quality, or
pixel-identical output. Verification is required before capture unless explicitly
bypassed. Approval includes a digest of the parsed plan; changing the plan requires
another rehearsal, while presentation-only changes do not.

### Capture

Capture uses Chromium's CDP screencast and streams frames into user-installed
FFmpeg. It produces immutable facts: `browser.mp4` and `events.json`. The event
set is `navigation`, `cursor-move`, `click`, `key-press`, and `scroll`, and each
event carries the plan step that caused it so presentation can anchor to it.

### Render

`packages/core` holds framework-free schemas and pure cursor, clustering, layout,
and camera math. `packages/renderer` builds the filter graph for the
browser frame, cursor, click feedback, keyboard HUD, zooms, and background.
Rendering reads the recording and presentation and never changes them.
Presentation anchors to plan steps, so a re-record still frames the right
actions. The `record` command captures and then renders; `render` re-renders an
existing recording with new presentation.

## Project folder

```text
session.json          live browser + selected tab + limits
observations/*.json   what the page looked like
plan.json             steps + expect
recording/*           browser.mp4 + events.json (facts)
presentation.json     zooms, trim, canvas, frame
output.mp4            final video
```

Every command reads files, does one thing, and writes files. Files are the API
between stages.

## Dependency direction

```text
core ← renderer ← cli renderer
core ← cli capture
drivers + session + plan + verify + capture + renderer ← cli commands
skill → cli commands
```
