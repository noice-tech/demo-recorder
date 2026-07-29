# Planning

Use a version 1 `demo-plan.json`. When a persistent exploration path passed verification, start from `explore export-plan` and preserve its representable interaction core instead of writing the plan from scratch. Manual authoring is the fallback for stories without a verified interactive path or for the specific portion export cannot represent. The agent supplies editorial reasoning; Demo Recorder supplies deterministic handoff, validation, and execution.

```json
{
  "version": 1,
  "name": "site-overview",
  "brief": {
    "goal": "Introduce the site and show its examples and pricing",
    "audience": "New visitors",
    "targetDurationMs": 20000,
    "constraints": {
      "submitForms": false,
      "modifyData": false,
      "sameOriginOnly": true
    }
  },
  "target": { "baseUrl": "https://example.com" },
  "capture": {
    "steps": [
      { "type": "navigate", "url": "/", "purpose": "Establish the product" },
      { "type": "hold", "durationMs": 1200 },
      {
        "type": "click",
        "locator": { "primary": { "by": "role", "role": "link", "name": "Examples" } },
        "purpose": "Show representative work"
      },
      { "type": "wait-for-url", "urlPattern": "**/examples" },
      { "type": "hold", "durationMs": 1800 }
    ]
  },
  "presentation": {
    "beats": [{ "label": "Examples", "importance": "primary" }]
  }
}
```

Locator methods are `role`, `text`, `label`, `placeholder`, `test-id`, and `css`. Prefer role and accessible name. A locator may contain up to three `fallbacks` observed during exploration.

Actions are `navigate`, `move`, `click`, `fill`, `press`, `select`, `scroll`, `wait-for`, `assert-visible`, `wait-for-url`, and `hold`. Read-only plans should not use fill, press, or select. Keep holds purposeful and usually between 800–2000ms. A simple directed demo should usually need roughly 8–18 capture steps. Collapse adjacent exploratory scrolls in the same direction before verifying the selected path; after export, preserve the verified navigation, interaction, locator, scroll, URL, and generated assertion steps. The final plan is a directed story, not an exploration transcript.

If the target must be managed, add `repositoryPath`, `startCommand`, and optionally `readinessUrl`. If authenticated, add `authProfile`.

Before recording, rehearse the validated plan without video capture:

```bash
npx --yes @noice-tech/demo-recorder@0.0.1 plan rehearse \
  .demo-recorder/plans/product-demo/demo-plan.json \
  --attempt 1 \
  --json
```

A failed rehearsal writes the failing step, sanitized current URL, ARIA snapshot, screenshot, trace, and focused repair hints. The host agent may revise only the failing plan area and rerun with `--attempt 2` or `--attempt 3`; attempts outside 1–3 are rejected. Require a passing rehearsal before final capture. Once rehearsal passes, proceed to capture; do not run another attempt for optional polish unless the plan receives a functional change. The final `run` command remains deterministic and never invokes repair logic.

Presentation may include absolute source-timeline `trimStartMs`, `trimEndMs`, and explicit `zoomSegments`. Prefer capture `hold` steps for deliberate pacing. Add trims only after inspecting a recording; the renderer validates them against source duration without changing the manifest or WebM.
