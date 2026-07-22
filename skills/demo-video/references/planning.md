# Planning

Write a version 1 `demo-plan.json`. The agent supplies the reasoning; Demo Recorder supplies validation and deterministic execution.

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

Actions are `navigate`, `move`, `click`, `fill`, `press`, `select`, `scroll`, `wait-for`, `assert-visible`, `wait-for-url`, and `hold`. Read-only plans should not use fill, press, or select. Keep holds purposeful and usually between 800–2000ms.

If the target must be managed, add `repositoryPath`, `startCommand`, and optionally `readinessUrl`. If authenticated, add `authProfile`.

Presentation may include absolute source-timeline `trimStartMs`, `trimEndMs`, and explicit `zoomSegments`. Prefer capture `hold` steps for deliberate pacing. Add trims only after inspecting a recording; the renderer validates them against source duration without changing the manifest or WebM.
