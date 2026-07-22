# Agent-First Exploration and Direction

## Principle

Demo Recorder contains no embedded model client. A coding agent supplies semantic reasoning through normal repository and terminal tools. Runtime modules expose deterministic operations and durable JSON boundaries, so the same workflow can be used by Cursor, Pi, Claude Code, Codex, or another agent harness.

## Components

### Agent skill

`skills/demo-video` is the orchestration layer. It tells an agent when to inspect source, invoke browser exploration, request manual authentication, write a plan, validate safety, execute, render, and inspect output.

### Explorer

The CLI's `explorer` module provides:

- bounded same-origin Playwright crawling;
- headings, links, controls, forms, redirects, errors, and screenshots;
- control classification without form submission;
- generic repository facts without secret values;
- agent-selected local process startup, readiness, logs, and cleanup;
- detached headed authentication sessions;
- cookies/local-storage and same-origin session-storage profiles.

Exploration navigates discovered HTTP links directly. It reports tabs, menus, accordions, and other candidate controls for the agent, but does not click ambiguous or destructive controls.

### Planner

The CLI's `demo-plan` module is a protocol rather than an AI. It validates agent-authored `DemoPlan` documents, rejects default cross-origin and destructive steps, enforces read-only constraints, estimates duration, and produces a storyboard.

Plans use accessible locator specifications with controlled fallbacks. Generated TypeScript is unnecessary; the recorder executes validated JSON directly.

### Recorder and renderer

The CLI's `capture` module resolves plan locators and executes navigation, movement, click, fill, key, selection, scroll, visibility, URL, and hold steps. It stores the original plan and presentation direction beside immutable recording facts.

The CLI's `renderer` module continues to derive click zooms automatically. A validated `presentation.json` can provide explicit zoom segments, while the source WebM and manifest remain unchanged.

## Safe autonomy

Plans do not require an approval prompt. Instead, defaults are deliberately restrictive:

- same-origin navigation only;
- no form submission during exploration;
- no destructive exploration actions;
- no fill, press, or selection in plans where `modifyData` is false;
- destructive locator names are rejected;
- explicit local start commands only;
- generated and authentication state ignored by Git.

If a requested story genuinely requires data mutation, the agent must encode that intent by changing the brief constraints. Exploration itself remains read-only.

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
