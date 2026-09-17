# Development

Contributors need Node.js 22.18 or newer, pnpm, and user-installed `ffmpeg` and
`ffprobe` for rendering tests.

## Workspace ownership

| Path                     | Responsibility                                                             |
| ------------------------ | -------------------------------------------------------------------------- |
| `packages/core`          | Plan, recording, presentation schemas plus pure anchor and timeline math   |
| `packages/renderer`      | FFmpeg probing, filter graphs, timed overlays, assets, rendering           |
| `apps/cli/src/driver`    | Browser drivers (launched Chromium, attached CDP) and the runtime boundary |
| `apps/cli/src/session`   | Live session: snapshot, action, state file, limits                         |
| `apps/cli/src/runner.ts` | Plan execution shared by `plan rehearse` and `record`                      |
| `apps/cli/src/recorder`  | CDP screencast capture and the timestamped event log                       |
| `apps/cli/src/motion`    | Cursor paths, scroll gestures, key chords                                  |
| `apps/cli/src/renderer`  | Recording preparation and render orchestration                             |
| `apps/cli/src/commands`  | Thin command adapters                                                      |

> The CLI exposes the full contract surface: `explore start|pages|observe|act|finish`,
> `plan rehearse`, `record`, `render`, `inspect`, `doctor`, `setup`, and
> `auth start|save|remove`. The launched driver provides a runtime effect
> boundary and the attached CDP driver lists and observes real Chrome.
>
> **Deferred:** the Playwriter extension driver (`driver/playwriter.ts`, spec
> build order step 8). It depends on the third-party `playwriter` package, its
> relay server, and the Chrome extension, which are not part of this workspace.
> `--driver playwriter` therefore fails with a clear message; use
> `--driver cdp --target <cdp-url>` to attach and observe. See
> [`contract.md`](contract.md) and [`spec.md`](spec.md).

## Commands

```bash
pnpm install
pnpm exec playwright install chromium
pnpm check            # lint, format, typecheck, unit tests
pnpm build
pnpm package:cli
pnpm test:integration
pnpm demo:render <recording>
pnpm clean
```

`pnpm check` runs linting, formatting, type checks, and fast unit tests. Turbo
orders and caches workspace type checks and builds.

## Recording and rendering

The renderer accepts a recording directory or a `recording.json` path:

```bash
pnpm demo-recorder render <recording> --aspect-ratio 1:1 --padding 72
```

Output defaults to `output/<recording-id>.mp4`. See
[recording-format.md](recording-format.md).

A successful command prints the exact recording directory. Generated files are
ignored by Git. Do not edit a recording to add zooms or presentation choices;
those belong in `presentation.json`.

## Tests and failure paths

Fast checks run with `pnpm check`. Browser and renderer integration checks run
with `pnpm test:integration`. Integration tests use
`apps/cli/tests/fixtures/` and a test-only loopback server; fixtures are never
shipped.

## Cleanup

`pnpm clean` removes generated explorations, recordings, rendered outputs, every
direct `dist/` directory, and package assets. It preserves saved plans. Save any
recording or MP4 you want to keep before cleaning.
