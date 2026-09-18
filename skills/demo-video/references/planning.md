# Planning

Write a version 1 `plan.json` using the durable `target` recipes gathered during exploration. Never use an observation `ref` in a plan. Keep capture direction in the plan and styling in a separate `presentation.json`. The agent supplies editorial reasoning; Demo Recorder supplies validation, verification, and execution.

Put both files in the project folder (`--project DIR`): `DIR/plan.json` and `DIR/presentation.json`.

## plan.json

```json
{
  "version": 1,
  "name": "site-overview",
  "goal": "Introduce the site and show its examples and pricing",
  "target": { "baseUrl": "https://example.com" },
  "viewport": { "width": 1440, "height": 900 },
  "constraints": { "submitForms": false, "modifyData": false, "sameOriginOnly": true },
  "steps": [
    { "type": "navigate", "url": "https://example.com/", "purpose": "establish the product" },
    { "type": "hold", "durationMs": 1200 },
    {
      "type": "click",
      "target": { "role": "link", "name": "Examples" },
      "purpose": "show representative work",
      "expect": {
        "url": "/examples",
        "visible": { "role": "heading", "name": "Examples" },
        "timeoutMs": 5000
      }
    },
    { "type": "hold", "durationMs": 1800 }
  ]
}
```

`target` at the plan root is the app entry point (`baseUrl`). `target` inside a step is the durable element recipe. They are different fields with the same name; read them by position.

A step target uses `role`, `name`, and/or `selector`. Prefer `role` plus accessible `name`. To be recordable a target must resolve to exactly one visible element; the tool refuses to pick the first of several matches.

Step types are `navigate`, `click`, `fill`, `press`, `select`, `scroll`, and `hold`:

| type       | fields                      |
| ---------- | --------------------------- |
| `navigate` | `url`                       |
| `click`    | `target`                    |
| `fill`     | `target`, `value`           |
| `press`    | `key`, optional `target`    |
| `select`   | `target`, `value`           |
| `scroll`   | `deltaY`, optional `deltaX` |
| `hold`     | `durationMs`                |

Every step may add `purpose` (a note for reviewers) and `expect`. Keep holds purposeful and usually between 800–2000ms. A simple directed demo usually needs roughly 8–18 steps. The plan is a directed story, not an exploration transcript.

### expect

A step may carry `expect` with `url`, `visible`, and `timeoutMs`. All conditions must hold after the step or the step fails; there are no separate wait or assert step types. `url` is matched as a substring of the current URL. Verification runs the plan in a fresh browser and checks every `expect`.

### Human-performance standard

Treat the recording as if a practiced human presenter is operating the browser:

- Use `navigate` only to establish the initial page. A story route change must be a visible `click` on the link, card, tab, or button a person would use, followed by an `expect` on the destination. Mid-story direct navigation is a page teleport and is not acceptable in a finished demo.
- Do not convert a difficult or ambiguous link into `navigate`. Scroll or dismiss overlays to expose it, derive a unique durable target from evidence, and rehearse the click. If it cannot be made reliable, simplify the story instead of hiding the transition.
- Let a page settle before the first interaction. Use varied, purposeful pauses: roughly 600–1200ms before an ordinary decision, 800–1600ms after a meaningful state change, and 1800–3000ms for a final result or price reveal.
- Click steps already use curved minimum-jerk cursor motion. `move` is not a step type; long holds provide the visible moment of consideration.
- Scroll in deliberate, readable sections. Pause after a long scroll and avoid reversing direction without a narrative reason.
- On inspection, reject captures with blank route flashes, cursorless route changes, abrupt jumps, rushed reveals, or mechanical equal-tempo actions.

### Local and authenticated targets

This build does not manage an app process; start the app yourself and use its URL. If login is required, save state with `auth start` / `auth save` and pass it to exploration with `explore start --storage-state DIR/auth-state.json`. The plan itself has no auth field. Pass the same `--storage-state DIR/auth-state.json` to `plan rehearse` and `record`; attaching to logged-in Chrome does not authenticate those launched browsers.

## presentation.json

Styling is a separate file so it can change without re-recording. Effects anchor to plan steps, never to absolute time.

```json
{
  "version": 1,
  "canvas": { "aspectRatio": "1:1", "padding": 72, "background": "mist" },
  "trim": { "from": { "anchor": "start" }, "to": { "anchor": "end" } },
  "zooms": [{ "step": 3, "leadMs": 600, "holdMs": 1400, "scale": 1.6 }],
  "browserFrame": { "theme": "dark" }
}
```

`canvas` controls final framing without changing the immutable recording. `aspectRatio` accepts `16:9`, `1:1`, `9:16`, `source`, or another positive `WIDTH:HEIGHT` ratio; alternatively use explicit `width` and `height`. `padding` is the pixel distance between the canvas edge and the browser frame. `paddingMode` is `minimum` by default; use `exact` only with a capture viewport matched to the available content rectangle. `background` is a preset name (`midnight`, `ocean`, `aurora`, `prism`, `daybreak`, `tahoe`, `mist`), a `#RRGGBB` color, or `{ "type": "preset", "name": "mist" }`. Omit `browserFrame` to disable the frame.

A step zoom uses `step`; a range uses `fromStep` and `toStep`. `leadMs` starts the effect before the anchor and `holdMs` keeps it after. `trim` uses `from` and `to` anchors (`{ "step": n, "offsetMs": ms }` or `{ "anchor": "start" | "end" }`). Zooms must not overlap. Because everything is anchored to steps, a re-record still frames the right actions. An anchor that cannot be resolved from the recording fails the render instead of silently shifting.

Canvas-only changes can be rerendered without recapturing:

```bash
node "$DR_CLI" render --project DIR --overwrite --aspect-ratio 1:1 --padding 72
```

## Verify before capture

```bash
node "$DR_CLI" plan rehearse --project DIR --json
```

`plan rehearse` validates the plan, runs it in a fresh browser, and checks every `expect`. On failure it writes `DIR/rehearsal-report.json` and `DIR/evidence/step-N.png|yml`. Repair only the failing area and rerun. Require `ok: true` and `captureReady: true` before capture. Approval is bound to the parsed plan contents: edits require a new rehearsal, while unchanged reruns reuse approval. Styling-only edits do not invalidate it.

Choose the plan `viewport` before exploration when the user requests a particular browser size or responsive layout. The default is 1440×900. Pass the same value to exploration with `--viewport WIDTHxHEIGHT`. Changing the viewport after gathering targets requires exploring again because responsive controls may change.
