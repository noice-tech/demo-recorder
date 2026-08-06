# First-run setup

Use the exact runtime version required by the skill:

```text
DR_VERSION = 0.1.0
DR_PACKAGE = @noice-tech/demo-recorder@0.1.0
```

The commands in the other references use `node "$DR_CLI"` to mean the cached CLI path established here. Preserve that path for every command in the current task; never fall back to `npx`, a global installation, or a target-project dependency.

## Locate the user cache

Use a versioned directory under the platform's normal user cache:

- macOS: `~/Library/Caches/noice-tech/demo-recorder/0.1.0`
- Linux: `${XDG_CACHE_HOME:-$HOME/.cache}/noice-tech/demo-recorder/0.1.0`
- Windows: `%LOCALAPPDATA%\noice-tech\demo-recorder\0.1.0`

The CLI entry point is:

```text
<RUNTIME_ROOT>/node_modules/@noice-tech/demo-recorder/dist/cli.js
```

Set `DR_CLI` to that absolute path after choosing `RUNTIME_ROOT`. Do not rely on a relative path or mutate the target project's `PATH`.

## Reuse or install

If the entry point exists, run `node <entry-point> --version`. Reuse it only when it prints exactly `0.1.0`. A valid existing installation needs no new package consent.

If it is absent, corrupt, or has a different version, tell the user:

> Demo Recorder needs to install `@noice-tech/demo-recorder@0.1.0` and its npm dependencies in `<RUNTIME_ROOT>`. This is a versioned user cache: it will not change this project or install anything globally. npm lifecycle scripts will be disabled. May I continue?

Do not run npm until the user agrees. Then run:

```bash
npm install \
  --prefix "$RUNTIME_ROOT" \
  --omit=dev \
  --ignore-scripts \
  --no-save \
  --package-lock=false \
  --no-audit \
  --no-fund \
  @noice-tech/demo-recorder@0.1.0
```

On PowerShell, pass the same options with `$RuntimeRoot`:

```powershell
npm install `
  --prefix $RuntimeRoot `
  --omit=dev `
  --ignore-scripts `
  --no-save `
  --package-lock=false `
  --no-audit `
  --no-fund `
  "@noice-tech/demo-recorder@0.1.0"
```

Verify `node "$DR_CLI" --version` before executing any other CLI command. Ask again before installing a different package version.

## Environment checks

Run:

```bash
node "$DR_CLI" doctor --json
```

Inspect every capability, not only the overall status. Doctor may report multiple missing requirements together.

If `ffmpeg`, `ffprobe`, the required filters, or `libx264` are missing, direct the user to:

https://github.com/noice-tech/demo-recorder/blob/main/docs/install-ffmpeg.md

Do not run a system package manager for them. Pause until they confirm installation, then rerun doctor. On Windows, explain that they may need to restart the terminal or coding agent so it receives the updated `PATH`.

If Playwright Chromium is missing, explain that it will be downloaded into Playwright's user cache without changing the project, and ask separately for permission. After approval, run:

```bash
node "$DR_CLI" setup --chromium --accept-downloads --json
node "$DR_CLI" doctor --json
```

Do not use `--accept-downloads` without current user approval. If Chromium is already present, `setup --chromium` only verifies that it launches and does not require the flag.

Proceed only when the final doctor result is `ready`. On later invocations, reuse the exact cached runtime, run doctor once, and continue without installation prompts when all capabilities remain ready.
