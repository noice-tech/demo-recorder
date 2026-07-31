# Demo Video Agent Skill

A portable Agent Skills workflow for asking Pi, Claude Code, Codex, Cursor, or another terminal-capable coding agent to explore a web application, write a validated Demo Recorder plan, record it, and render an MP4.

Demo Recorder does not call a model API. The host coding agent supplies reasoning; the npm package supplies deterministic tools. The canonical skill entry point is [`SKILL.md`](SKILL.md).

Install from the public repository with:

```bash
npx skills add noice-tech/demo-recorder
```

Because this repository exposes one skill, the installer automatically selects `demo-video`. Node.js 22 or newer is required. Rendering also requires user-installed `ffmpeg` and `ffprobe`; see the [short installation guide](https://github.com/noice-tech/demo-recorder/blob/main/docs/install-ffmpeg.md). On first use the skill asks permission before installing the pinned `@noice-tech/demo-recorder` CLI into a versioned user cache, without changing the target project or installing it globally. It asks separately before downloading Playwright Chromium when `doctor` reports that setup is required. The skill and runtime share one product version; update checks happen only when requested and update the skill before its matching runtime.
