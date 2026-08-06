# Demo Recorder

**Create product demo videos with your coding agent.**

Describe the demo you need, and your coding agent explores the web app, records the flow, adds cursor movements and zooms, then renders the finished video.

![Example](docs/demo.gif)

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

Current capabilities:

- explore a web application and prepare the recording flow
- hand control back when login or CAPTCHA is required, then reuse the authenticated session
- avoid destructive or unclear actions unless explicitly requested
- record navigation, clicks, scrolling, and interface changes
- add smooth cursor movement, clicks, zooms, and trim unused parts
- save the walkthrough as a reusable plan that can be adjusted and recorded again
- render the finished video as an MP4

## Getting started

### Requirements

- Node.js 22 or newer
- `ffmpeg` and `ffprobe`
- Pi, Claude Code, Codex, Cursor, or another terminal-capable coding agent

See the [FFmpeg installation guide](docs/install-ffmpeg.md) for setup instructions on macOS, Windows, and Linux.

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

## Current status and plans

The current release is **0.0.1 Alpha**. The complete workflow - from exploring a product to rendering an MP4 - is available today, but commands, plan formats, and behavior may still change.

The next areas of focus are:

- additional canvas styles and export formats
- smoother animations and transitions
- tooltips for pressed keys
- ready-made templates for socials

See [Updates and releases](docs/updates.md) for information about versioning and updates.

## Contributing

Contributions, bug reports, and real-world examples are welcome. If you want to work on the project, start with the [development guide](docs/development.md).

For larger changes, opening an issue first is the easiest way to discuss the approach and avoid duplicated work.

## License

Demo Recorder is available under the [MIT License](LICENSE).

FFmpeg and ffprobe are used from your existing system installation and are not bundled with the project. See [Third-Party Notices](THIRD_PARTY_NOTICES.md) for bundled licenses and attributions.
