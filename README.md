# Noice Demo Recorder

Noice Demo Recorder is a local-first toolkit that helps coding agents turn web application flows into polished product-demo videos. An agent can explore the application, design a safe and repeatable demo story, execute it in the browser, capture the interactions, and render the result as an H.264 video.

The intelligence stays in Codex, Claude Code, Cursor, Pi, or any other terminal-capable coding agent. Demo Recorder does not call an LLM API itself. Instead, it provides deterministic runtime modules for application exploration, structured demo planning, browser execution, interaction capture, and video rendering.

> **Alpha:** `0.0.1` is an early release. Commands, plan schemas, recording formats, and safety behavior may change before beta.

## Licensing

Noice Demo Recorder's original source code is licensed under the [MIT License](LICENSE). Rendering uses Remotion, which is governed by the separate [Remotion License](https://www.remotion.dev/license) and may require a paid license depending on your organization and use case. Playwright is licensed under Apache-2.0.

See [Third-Party Notices](THIRD_PARTY_NOTICES.md) for the bundled license texts, attributions, and information about Chromium downloaded during setup.

## Agent-first workflow

Describe the story you want—not the recording commands. Ask your coding agent something like:

> Create a polished 25-second demo of https://banger.show. Start on the home page, give a quick sense of the product, then open the music visualizer and show it in action. Keep it smooth, show the key interactions.

The [`demo-video` skill](skills/demo-video/SKILL.md) guides the agent through the complete workflow:

1. **Understand the product**  
   The agent reviews the available source, documentation, and product context to identify the main value, important features, and any setup constraints.

2. **Explore the experience safely**  
   It visits the application, maps relevant pages and controls, captures reference screenshots, and avoids destructive or irreversible actions.

3. **Direct a focused story**  
   The agent chooses a short narrative, deciding what viewers should see, which interactions matter, how long each moment should breathe, and where the demo should end.

4. **Validate the walkthrough**  
   Before recording, it checks that each interaction is reachable, safe, and reliable and that the overall sequence fits the requested duration.

5. **Record the interactions**  
   Demo Recorder executes the approved walkthrough consistently in the browser while capturing navigation, cursor movement, clicks, and interface states.

6. **Render and review the video**  
   The capture is turned into a polished MP4. The agent visually inspects the result for framing, pacing, alignment, startup state, and the intended final scene.

## Quick start

Install the canonical skill into a supported coding agent with:

```bash
npx skills add noice-tech/demo-recorder
```

Ask the agent for a demo. The skill checks Node, asks before downloading and executing the pinned CLI through `npx`, separately asks before downloading Playwright Chromium when required, and completes the workflow through the final MP4.

## Requirements

Node.js 22 or newer is the only prerequisite for the installed workflow. No global CLI or target-project dependency is required.

## Architecture

```text
Coding agent + skill
   ├── repository tools
   └── CLI explorer + demo-plan modules
                    ↓
          validated demo plan
                    ↓
            CLI capture module
                    ↓
 recording.json + browser.webm + presentation.json
                    ↓
           CLI renderer module
                    ↓
            output/<id>.mp4
```

`recording.json` remains the immutable capture boundary. Agent-authored direction is stored separately in `demo-plan.json` and `presentation.json`.

See [`docs/agent-first-workflow.md`](docs/agent-first-workflow.md) and [`docs/architecture.md`](docs/architecture.md).

## Development

Contributors use Node.js 22.18 or newer, pnpm 10, tsdown, and Turbo through the checked-in workspace:

```bash
pnpm install
pnpm exec playwright install chromium
pnpm package:cli
pnpm demo-recorder doctor
```

`pnpm build` uses Turbo for workspace ordering and caching. `pnpm package:cli` builds the Remotion composition, bundles the standalone CLI and auth daemon with tsdown, and prepares npm package assets.

## Remotion Studio

```bash
pnpm studio
pnpm studio:recording <recording-id-or-path>
```

## Checks and cleanup

```bash
pnpm check
pnpm test:integration
pnpm build
pnpm test:package
pnpm clean
```

Cleanup removes generated explorations, recordings, outputs, bundles, and Studio assets. It preserves `.demo-recorder/plans/` and `.demo-recorder/auth/`.

## Important directories

- `packages/core/` — immutable recording schemas and pure timeline/layout logic
- `apps/cli/src/explorer/` — browser/repository exploration, managed apps, and auth profiles
- `apps/cli/src/demo-plan/` — plan schemas, safety validation, estimation, and storyboards
- `apps/cli/src/capture/` — plan execution, Playwright capture, and instrumented actions
- `apps/cli/src/renderer/` — asset preparation and Remotion rendering
- `apps/cli/tests/` — unit, integration, fixture, and package pipeline support
- `apps/remotion/` — React composition and presentation
- `skills/demo-video/` — portable agent workflow
- `.demo-recorder/` — ignored explorations, plans, and authentication state
- `recordings/` and `output/` — generated capture and video artifacts
