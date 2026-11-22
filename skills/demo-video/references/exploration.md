# Exploration

## Persistent session

Default to launched Playwright Chromium. Use CDP only when the user requests their existing browser; do not load or invoke Playwriter unless explicitly requested.

Explore with a persistent session. It is the only exploration path, and it keeps same-page controls such as tabs, menus, dialogs, drawers, or other SPA state alive between commands:

```bash
node "$DR_CLI" explore start \
  --project ./demo \
  --url https://example.com \
  --viewport 1440x900 \
  --json
```

Exploration runs under the same runtime boundary as rehearsal and recording. Top-level navigation may reach only the `--url` origin, the origin it redirected to, and origins passed as `--allow-origin https://shop.example.com,https://id.example.com`; embedded frames load from anywhere. The session summary lists `allowedOrigins`; copy any origin beyond the base URL's into the plan's `target.allowedOrigins`. When `act` reports `blocked`, such as `off-origin navigation …` or `new window …`, the action ran but its effect was stopped, and recording would stop it too. To allow another origin, finish and start exploration again with `--allow-origin`.

The response contains the session summary and the first observation: URL, title, viewport, scroll, console errors, the path of a screenshot, and `snapshot`, Playwright's accessibility tree of the page:

```yaml
- banner [ref=e2]:
    - button "Create project" [ref=e5] [cursor=pointer]
- region "Pricing" [ref=e11]:
    - button "Choose plan" [ref=e20]
    - iframe [ref=e26]:
        - button "Preview action" [ref=f1e2]
```

Every element carries a ref, including elements in open shadow roots and iframes. Refs are valid only for that observation.

Propose one bounded action at a time as JSON:

```json
{ "type": "click", "observationId": "obs-0001", "ref": "e4", "purpose": "open templates" }
```

Then execute it:

```bash
node "$DR_CLI" explore act --project ./demo --input action.json --json
```

A successful `act` response already includes the next observation with fresh refs. Continue from it instead of issuing a redundant `observe`.

## Actions

Exploration actions use `observationId` plus `ref`:

| type       | selector                                |
| ---------- | --------------------------------------- |
| `navigate` | `url`                                   |
| `click`    | `observationId`, `ref`                  |
| `fill`     | `observationId`, `ref`, `value`         |
| `press`    | `key`, optional `observationId` + `ref` |
| `select`   | `observationId`, `ref`, `value`         |
| `scroll`   | `deltaY`, optional `deltaX`             |
| `hold`     | `durationMs`                            |

`click`, `fill`, `select`, and `press` with a `ref` must resolve to exactly one visible element. Waiting and assertions are not exploration actions. An action that cannot happen fails within 5 seconds and says why, for example `covered by <div id="consent-banner">`; dismiss what covers the control, reveal it, or choose another one. Failures are printed as `{ "ok": false, "error": "..." }` on stdout when `--json` is passed.

Before performing an action, the tool derives the element's durable `target` recipe (role plus exact accessible name, narrowed by `within` to the nearest named container when the control is repeated) and reports `recordable: true | false`. A target that is still ambiguous marks the step `recordable: false`. If the page changed since the observation, for example through a timer, `act` refuses the stale ref and asks for `explore observe`. The action still runs so exploration is not blocked, but a non-recordable step cannot go into a plan; find a unique identifier or choose a different path. The result also reports the classified `risk` and the policy `reason`.

## Policy

The policy classifies the live element when an action runs; observations do not list risk. The default `read-only` policy allows navigation within the allowed origins and controls classified as presentational. Unknown, mutation-like, destructive, form, and external-side-effect controls are blocked, and a blocked action fails with the reason.

Use `--policy reversible` only with the user's explicit permission. Ask before `explore start` when the story involves choosing options (radio buttons, checkboxes, selects, toggles), because changing the policy means restarting exploration. Prefer a disposable local or staging environment; on a production site, tell the user that reversible controls can still save state, such as a settings toggle that saves itself. It still blocks destructive and external-side-effect controls. These policies are conservative guardrails, not proof that an application cannot produce a server-side side effect.

## Observation and limits

Use `explore observe` only for pages that changed without an explorer action, such as externally updated or time-driven UI:

```bash
node "$DR_CLI" explore observe --project ./demo --json
```

Each observation is written as `observations/<id>.json` plus `<id>.yml` (the same snapshot) and `<id>.png` (screenshot).

A session ends itself after 5 minutes idle, 20 minutes total, or 200 actions. Override at start with `--idle-timeout`, `--max-duration` (never above 60 minutes), and `--max-actions`. Always close it:

```bash
node "$DR_CLI" explore finish --project ./demo --json
```

`finish` closes the browser only when the Tool owns it and removes `session.json`.

## Attached browser

The Playwriter extension driver is not available in this build; explain this limitation if requested. When the user requests their existing browser, use Chrome configured with a remote debugging port and attach through Playwright CDP. Discover tabs before starting a session, then select one explicitly. Discovery reads tab metadata only. Exploration drives only the selected tab and never closes the user's browser:

```bash
node "$DR_CLI" explore pages --driver cdp --target http://127.0.0.1:9222 --json
node "$DR_CLI" explore start --project ./demo --driver cdp --target http://127.0.0.1:9222 --page <tab-id> --json
```

If more than one tab is open and no `--page` was given, `explore start` fails and asks for a selection. Tab ids remain tied to their tabs rather than list positions. Once started, `explore pages --project ./demo` lists tabs through the session. Attached sessions default to `read-only` and cannot record video. Their login state is not automatically reused by launched rehearsal or recording; use the [authentication guide](authentication.md).

## Local repository

This build does not manage an app process. Start the app yourself (for example `pnpm dev`) and point `--url` at it. Inspect startup documentation and scripts first, and never expose values from `.env` or runtime output.

Never upload, purchase, publish, delete, send, invite, deploy, grant OAuth consent, or expose secrets during exploration. Read the observation snapshots, and screenshots where layout matters, before writing a plan.
