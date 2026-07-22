# Demo Video Agent Skill

A portable Agent Skills workflow for asking Pi, Claude Code, Codex, Cursor, or another terminal-capable coding agent to explore a web application, write a validated Demo Recorder plan, record it, and render an MP4.

Demo Recorder does not call a model API. The host coding agent supplies reasoning; the npm package supplies deterministic tools. The canonical skill entry point is [`SKILL.md`](SKILL.md).

Install from the public repository with:

```bash
npx skills add noice-tech/demo-recorder
```

Because this repository exposes one skill, the installer automatically selects `demo-video`. Node.js 22 or newer is required. On first use the skill asks permission before downloading and executing the pinned `@noice-tech/demo-recorder` CLI through `npx`. It asks separately before downloading Playwright Chromium when `doctor` reports that setup is required.
