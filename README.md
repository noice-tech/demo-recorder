# Noice Demo Recorder

Noice Demo Recorder is a local-first toolkit that helps coding agents turn web application flows into polished product-demo videos. An agent can explore the application, design a safe and repeatable demo story, execute it in the browser, capture the interactions, and render the result as an H.264 video.

The intelligence stays in Codex, Claude Code, Cursor, Pi, or any other terminal-capable coding agent. Demo Recorder does not call an LLM API itself. Instead, it provides deterministic runtime modules for application exploration, structured demo planning, browser execution, interaction capture, and video rendering.

> **Alpha:** `0.0.1` is an early release. Commands, plan schemas, recording formats, and safety behavior may change before beta.

## Demo

**Prompt example:**

> Create a short demo of banger.show: choose a template, create a project, and show the result in the editor.

![Demo Recorder workflow](docs/demo.gif)

## Licensing

Noice Demo Recorder's original source code is licensed under the [MIT License](LICENSE). Rendering invokes user-installed FFmpeg and ffprobe; their binaries are not bundled or redistributed. The bundled Inter font is licensed under the SIL Open Font License 1.1, and Playwright is licensed under Apache-2.0.

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

4. **Validate and rehearse the walkthrough**
   Before recording, it verifies selected exploration transitions in a fresh context, exports a passing interactive path as the default draft-plan handoff, and rehearses the final plan without video capture. Ambiguous locators and failed postconditions produce targeted diagnostics instead of being hidden.

5. **Record the interactions**  
   Demo Recorder executes the approved walkthrough consistently in the browser while capturing navigation, cursor movement, clicks, and interface states.

6. **Render and review the video**  
   The capture is turned into a polished MP4. The agent visually inspects the result for framing, pacing, alignment, startup state, and the intended final scene.

## Quick start

Install the canonical skill into a supported coding agent with:

```bash
npx skills add noice-tech/demo-recorder
```

Ask the agent for a demo. On first use, the skill checks Node and asks before installing the exact CLI version into a versioned user cache; it never adds the runtime to your project or installs it globally. It checks FFmpeg, links to the platform setup guide when needed, separately asks before downloading Playwright Chromium, and then completes the workflow through the final MP4.

## Requirements

The installed workflow requires Node.js 22 or newer plus `ffmpeg` and `ffprobe` with the capabilities reported by `demo-recorder doctor`. See the short [FFmpeg installation guide](docs/install-ffmpeg.md) for macOS, Windows, and popular Linux distributions. The pinned CLI is installed in the user's cache on first use; no global CLI or target-project dependency is required.

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
