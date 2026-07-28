---
name: demo-video
description: Create polished product demo, feature walkthrough, app showcase, or product-tour videos from a public or staging URL, localhost app, or local repository. Safely explore the application, plan browser interactions, record them, render an MP4, and inspect the result. Use when the user asks to create or record a demo video, product walkthrough, feature showcase, app tour, or website presentation.
compatibility: Requires Node.js 22+, user-installed ffmpeg and ffprobe, terminal and process access, and permission to download the Demo Recorder npm package and Playwright Chromium on first use.
---

# Agent-Directed Demo Video

Act as the explorer and director. Demo Recorder makes no model API calls; use repository tools for reasoning and the deterministic CLI for execution.

After obtaining the consent described below, use `npx --yes @noice-tech/demo-recorder@0.0.1` as the non-interactive CLI runner for every command. `--yes` only accepts npm's package-download prompt; it does not replace user approval. Do not install the CLI globally or add it to the target project by default.

1. Check Node before any npm command: `node -e 'const major=Number(process.versions.node.split(".")[0]); process.exit(major >= 22 ? 0 : 1)'`. If Node is absent or unsupported, stop and ask the user to install Node.js 22 or newer; never install a system Node runtime automatically.
2. Before the first CLI invocation in the current task, tell the user that the skill needs to download and execute the exact npm package `@noice-tech/demo-recorder@0.0.1` without adding it to their project, and ask for explicit permission. Do not run any `npx` command until they confirm. Their consent applies only to that package version for the current task; ask again if the version changes.
3. Run `npx --yes @noice-tech/demo-recorder@0.0.1 doctor --json`. If it reports `needs-setup` and exits 2, explain that setup downloads Playwright Chromium and ask for separate explicit permission. Only after confirmation, run `npx --yes @noice-tech/demo-recorder@0.0.1 setup --json`, then rerun doctor. Rendering also requires user-installed `ffmpeg` and `ffprobe`; never download or install those system executables automatically. Stop and explain any missing capabilities if the final status is not `ready`.
4. Turn the request into a concise goal, audience, duration, and safety constraints.
5. If source is available, inspect `package.json`, routes, navigation, tests, auth, and startup docs. Never read or print secret values.
6. Run safe browser exploration. Use `npx --yes @noice-tech/demo-recorder@0.0.1 explore --url <url>` for a link-based surface map. For tabs, menus, dialogs, drawers, or other same-page state, use the persistent `explore start` → `explore act`/`find`/`current` → `explore finish` protocol in [the exploration guide](references/exploration.md). Add `--repo <path> --start '<command>'` for a managed local app.
7. Read `exploration.json`, `summary.md`, observations, ARIA snapshots, and relevant screenshots. Use the post-action observation returned by `act`; use `current` to retrieve it again without recapturing, and reserve `observe` for externally changing pages. Use one bounded action at a time and treat refs as observation-scoped. Before planning from an interactive path, run `explore verify` on the selected connected transitions and require a passing fresh-context report. Always finish or abort a persistent session. Do not submit forms or use destructive controls during exploration.
8. If authentication is required, run `npx --yes @noice-tech/demo-recorder@0.0.1 auth start --url <login-url> --profile <name>`, tell the user to complete the visible login/CAPTCHA, and after they say done run `npx --yes @noice-tech/demo-recorder@0.0.1 auth save --profile <name>`.
9. Write `.demo-recorder/plans/<name>/demo-plan.json` using [the planning guide](references/planning.md), or export a passing verified path with `explore export-plan` and then edit the draft as a director. Prefer a short coherent story over exhaustive coverage.
10. Run `npx --yes @noice-tech/demo-recorder@0.0.1 plan validate <plan>` and fix every failure. No additional approval prompt is required for a safe read-only plan after package consent.
11. Run `npx --yes @noice-tech/demo-recorder@0.0.1 plan rehearse <plan> --attempt 1 --json`. Require a passing report before capture. On failure, inspect its snapshot/screenshot/trace, repair only the failing area, and use at most attempts 2 and 3.
12. Run `npx --yes @noice-tech/demo-recorder@0.0.1 run <plan>` and wait for both recording and FFmpeg rendering to complete. Do not stop after `record`; `recordings/<id>/browser.webm` is raw capture and is never the final deliverable. Final capture never performs repair. Use `--headed` only when the target requires it.
13. Confirm `output/<id>.mp4` exists. Run `npx --yes @noice-tech/demo-recorder@0.0.1 inspect <mp4> --contact-sheet` when FFmpeg is available, then inspect metadata and the sheet for browser framing, startup state, cursor, clicks, zooms, pacing, alignment, and the intended final state.
14. Revise and rerun when needed. Report the raw recording path and final rendered MP4 path separately, labeling the MP4 as the deliverable.

Follow [exploration safety](references/exploration.md) and [authentication handling](references/authentication.md). Do not import `previous/` or `references/` into production code. Never claim that Demo Recorder itself contains an LLM.
