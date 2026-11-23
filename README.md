# Demo Recorder

**Create product demo videos with your coding agent.**

Describe the demo you need, and your coding agent explores the web app, records the flow, adds cursor movements and zooms, then renders the finished video.

![Example](docs/demo.gif)

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

What it does:

- explores a web app and writes the walkthrough as a plan you can edit and record again
- checks each step's result, such as the page it should reach or an element that should appear, in a rehearsal run before recording
- hands control back to you for login or CAPTCHA, then reuses the signed-in session
- blocks destructive or unclear actions, and navigation to sites you didn't allow, unless you ask for them
- records navigation, clicks, typing, keyboard shortcuts, and scrolling, including scrolling to a section by name
- adds smooth cursor movement, click feedback, keyboard shortcut overlays and zooms, and trims unused parts
- renders the finished video as an MP4

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

On first use, the skill asks before it installs its pinned runtime into a user cache. If Playwright Chromium isn't installed, it asks again before downloading it.

Or ask it to record the result of a development task:

> Implement the new sharing flow, then record a short demo showing how it works.

## Current status and plans

In 0.2.0, each demo lives in one project folder, `recordings/<name>/` by default. It holds the exploration, the plan, the rehearsal results, the recording, and `run.json` with where the run's time went. When a step fails, the error says why, for example which element covers a button or that the site never answered.

Demo Recorder explores and records in its own Playwright Chromium. It can also explore in your own Chrome, but can't record there yet.

Planned next: recording in your own browser, and more export formats.

## Contributing

Contributions, bug reports, and real-world examples are welcome. If you want to work on the project, start with the [development guide](docs/development.md).

For larger changes, please open an issue first so we can agree on the approach before you start.

## License

Demo Recorder is available under the [MIT License](LICENSE).

Demo Recorder runs the FFmpeg and ffprobe installed on your system and doesn't bundle them. See [Third-Party Notices](THIRD_PARTY_NOTICES.md) for bundled licenses and attributions.
