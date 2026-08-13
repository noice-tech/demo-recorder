# Planning

Use a version 1 `demo-plan.json`. When a persistent exploration path passed verification, start from `explore export-plan` and preserve its representable interaction core instead of writing the plan from scratch. A suitable existing Playwright test can instead provide the initial flow through the static importer below. Manual authoring is the fallback for stories without either source. The agent supplies editorial reasoning; Demo Recorder supplies deterministic handoff, validation, and execution.

## Playwright conversion

Import one inline Playwright test without executing the spec or its configuration:

```bash
node "$DR_CLI" plan import-playwright tests/settings.spec.ts \
  --test "settings opens profile" \
  --base-url http://127.0.0.1:3000 \
  --output .demo-recorder/plans/settings/demo-plan.json \
  --json
```

The importer supports ordinary `page` navigation, accessible locators, click, hover, fill, press, selection, wheel scrolling, URL/visibility waits, and simple inline `beforeEach` and `test.step` blocks. It deliberately rejects helpers, page objects, computed locators, loops, conditionals, frames, and other behavior it cannot preserve. If several tests exist, its diagnostic lists their full titles so one can be selected with `--test`. Use `--allow-modify-data`, `--allow-submit-forms`, or `--allow-cross-origin` only when the requested demo explicitly permits those risks. Never treat imported auth setup as safe plan data.

An imported plan is not verified exploration evidence. Review its flow, add only editorial holds and purposes needed for human pacing, validate it, and require the normal full rehearsal. Use focused browser exploration when an unsupported portion must be replaced from UI evidence.

Export a validated plan as a Playwright test:

```bash
node "$DR_CLI" plan export-playwright \
  .demo-recorder/plans/settings/demo-plan.json \
  --output tests/settings-demo.spec.ts \
  --json
```

The generated test uses the plan's base URL, viewport, primary locators, interactions, and URL/visibility checks. Presentation settings are not test behavior. Editorial holds are omitted unless `--preserve-holds` is set; locator fallbacks, auth profiles, and managed start commands are reported rather than embedded. Use `--test-import playwright/test` when the target project uses that import instead of `@playwright/test`.

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
    "viewport": { "width": 1280, "height": 720 },
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
    "beats": [{ "label": "Examples", "importance": "primary" }],
    "canvas": { "aspectRatio": "1:1", "padding": 72, "paddingMode": "minimum" }
  }
}
```

Locator methods are `role`, `text`, `label`, `placeholder`, `test-id`, and `css`. Prefer role and accessible name. A locator may contain up to three `fallbacks` observed during exploration.

Actions are `navigate`, `move`, `click`, `fill`, `press`, `select`, `scroll`, `wait-for`, `assert-visible`, `wait-for-url`, and `hold`. Read-only plans should not use fill, press, or select. Keep holds purposeful and usually between 800–2000ms. A simple directed demo should usually need roughly 8–18 capture steps. Collapse adjacent exploratory scrolls in the same direction before verifying the selected path; after export, preserve the verified interaction, locator, scroll, URL, and generated assertion steps. The final plan is a directed story, not an exploration transcript.

## Human-performance standard

Treat the recording as if a practiced human presenter is operating the browser:

- Use `navigate` only to establish the initial page. A story route change must be a visible `click` on the link, card, tab, or button a person would use, followed by `wait-for-url` or a visible destination assertion. Mid-story direct navigation is a page teleport and is not acceptable in a finished demo.
- Do not convert a difficult or ambiguous link into `navigate`. Scroll or dismiss overlays to expose it, derive a unique durable locator from evidence, and rehearse the click. If it cannot be made reliable, simplify the story instead of hiding the transition.
- Let a page settle and remain readable before the first interaction. Use varied, purposeful pauses rather than identical delays: roughly 600–1200ms before an ordinary decision, 800–1600ms after a meaningful state change, and 1800–3000ms for a final result or price reveal.
- Click actions already use curved minimum-jerk cursor motion. Add `move` before a click only when a brief hover or visible moment of consideration improves the story; avoid decorative cursor wandering and repeated exact-center motions.
- Scroll in deliberate, readable sections. Pause after a long scroll, avoid reversing direction without a narrative reason, and never trigger navigation while scrolling is still settling.
- Show decisions rather than merely reaching states. When comparing options, allow the first selection and its price or visual change to register before changing to another option.
- On inspection, reject captures with blank route flashes, cursorless route changes, abrupt jumps, rushed reveals, mechanical equal-tempo actions, or unexplained idle time.

If the target must be managed, add `repositoryPath`, `startCommand`, and optionally `readinessUrl`. If authenticated, add `authProfile`.

Before recording, optionally run a fast functional preflight for a long plan:

```bash
node "$DR_CLI" plan rehearse \
  .demo-recorder/plans/product-demo/demo-plan.json \
  --attempt 1 \
  --fast \
  --json
```

Fast mode compresses only editorial holds and scroll animation. It preserves navigation, locators, clicks, and postconditions, but reports `captureReady: false` because it does not validate presentation pacing. Follow it with a full-speed rehearsal before capture, using the appropriate attempt number and omitting `--fast`.

A failed rehearsal writes the failing step, sanitized current URL, ARIA snapshot, screenshot, trace, and focused repair hints. The host agent may revise only the failing plan area and rerun with `--attempt 2` or `--attempt 3`; attempts outside 1–3 are rejected. Require a full-mode passing rehearsal (`captureReady: true`) before final capture. Once that rehearsal passes, proceed to capture; do not run another attempt for optional polish unless the plan receives a functional change. The final `run` command remains deterministic and never invokes repair logic.

Choose `capture.viewport` before exploration when the user requests a particular browser size or responsive layout. The default is 1440×900. Pass the same value to exploration with `--viewport WIDTHxHEIGHT`; verified plan export preserves it. Browser viewport and output canvas are independent: for example, a 1280×720 browser can sit inside a square canvas. Changing the viewport after verification requires exploring and verifying again because responsive controls and locators may change.

Presentation `canvas` controls final framing without changing the immutable browser recording. `aspectRatio` accepts `16:9`, `1:1`, `9:16`, `source`, or another positive `WIDTH:HEIGHT` ratio; alternatively use explicit `width` and `height`. `padding` is the requested pixel distance between the canvas edge and browser frame. `paddingMode` is `minimum` by default, preserving the complete capture and allowing extra space on one axis. Use `exact` only with a capture viewport matched to the available content rectangle; the renderer rejects mismatched ratios rather than stretching the interface. The available content ratio is `(canvasWidth - 2 × padding) / (canvasHeight - 2 × padding - 48)`. Defaults remain a 1920×1080 canvas and 97px minimum padding. Canvas-only changes can be rerendered without recapturing. Use `demo-recorder render <recording> --aspect-ratio 1:1 --padding 72` for a temporary override, or `--size 1600x1000` for explicit dimensions.

Presentation may include absolute source-timeline `trimStartMs`, `trimEndMs`, and explicit `zoomSegments`. Prefer capture `hold` steps for deliberate pacing. Add trims only after inspecting a recording; the renderer validates them against source duration without changing the manifest or WebM.
