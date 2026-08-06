# Demo Recorder

**Create product demo videos with your coding agent.**

Describe the demo you need, and your coding agent explores the web app, records the flow, adds cursor movements and zooms, then renders the finished video.

![Example](https://raw.githubusercontent.com/noice-tech/demo-recorder/main/docs/demo.gif)

> **Alpha:** Demo Recorder is under active development. Expect rough edges and changes before the first stable release.

## What it's for

Shipping features is fast. Recording demos usually isn't.

You have to plan the walkthrough, record a clean take, edit it, and package everything for sharing. Then the product changes and the video is already out of date.

Demo Recorder lets you automate this through your coding agent. Tell it the flow you want, and it walks through the product, records the demo, and renders the video. It can also record a feature after an agent finishes building it, making the result easier to review without manually retracing the flow.

Common use cases:

- demos for product updates and release posts
- short walkthroughs for documentation and tutorials
- video previews of features built by coding agents
- visual context for pull requests and handoffs
- clips for launch posts and social media
- internal walkthroughs for teammates and stakeholders

## Getting started

### Requirements

- Node.js 22 or newer
- `ffmpeg` and `ffprobe`
- Pi, Claude Code, Codex, Cursor, or another terminal-capable coding agent

See the [FFmpeg installation guide](https://github.com/noice-tech/demo-recorder/blob/main/docs/install-ffmpeg.md) for setup instructions on macOS, Windows, and Linux.

### Installation

Install the skill:

```bash
npx skills add noice-tech/demo-recorder
```

Then ask your coding agent for the demo you want:

> Create a short demo of banger.show. Start on the home page, open the music visualizer, and show it in action. Keep it smooth and under 25 seconds.

On first use, the skill asks before installing its pinned runtime in a user cache. It also asks separately before downloading Playwright Chromium if it is not already available.

Or ask it to record the result of a development task:

> Implement the new sharing flow, then record a short demo showing how it works.

## npm package

This package supplies the deterministic Demo Recorder tools used by the skill. The host coding agent supplies the reasoning; Demo Recorder does not call a model API.

For the complete workflow, documentation, and examples, see the [Demo Recorder repository](https://github.com/noice-tech/demo-recorder#readme).

## License

Demo Recorder is available under the [MIT License](https://github.com/noice-tech/demo-recorder/blob/main/LICENSE).

FFmpeg and ffprobe are used from your existing system installation and are not bundled with the project. See [Third-Party Notices](https://github.com/noice-tech/demo-recorder/blob/main/THIRD_PARTY_NOTICES.md) for bundled licenses and attributions.
