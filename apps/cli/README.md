# Demo Recorder

**Create product demo videos with your coding agent.**

Describe the demo you need, and your coding agent explores the web app, records the flow, adds cursor movements and zooms, then renders the finished video.

![Example](https://raw.githubusercontent.com/noice-tech/demo-recorder/main/docs/demo.gif)

> Actively developed. Commands and file formats may change between minor releases.

## What it's for

A demo video means planning the walkthrough, recording a clean take, editing it, and exporting it. When the product changes, you do it all again.

Demo Recorder hands that work to your coding agent. Tell it the flow you want, and it walks through the product, records the demo, and renders the video. It can also record a feature right after an agent builds it, so reviewers watch the result instead of clicking through the flow themselves.

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

On first use, the skill asks before it installs its pinned runtime into a user cache. If Playwright Chromium isn't installed, it asks again before downloading it.

Or ask it to record the result of a development task:

> Implement the new sharing flow, then record a short demo showing how it works.

## npm package

This package is the command-line tool the `demo-video` skill runs. Your coding agent decides what to do, and Demo Recorder carries it out without calling a model API.

For the complete workflow, documentation, and examples, see the [Demo Recorder repository](https://github.com/noice-tech/demo-recorder#readme).

## License

Demo Recorder is available under the [MIT License](https://github.com/noice-tech/demo-recorder/blob/main/LICENSE).

Demo Recorder runs the FFmpeg and ffprobe installed on your system and doesn't bundle them. See [Third-Party Notices](https://github.com/noice-tech/demo-recorder/blob/main/THIRD_PARTY_NOTICES.md) for bundled licenses and attributions.
