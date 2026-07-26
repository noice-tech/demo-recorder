# Development

Contributors need Node.js 22.18 or newer and pnpm 10. The checked-in `.node-version` pins Node.js 22.19.0.

## Workspace ownership

| Path                     | Responsibility                                                            |
| ------------------------ | ------------------------------------------------------------------------- |
| `packages/core`          | Recording contracts and pure cursor, clustering, layout, and camera logic |
| `apps/cli/src/explorer`  | Safe browser/repository exploration, managed apps, and auth profiles      |
| `apps/cli/src/demo-plan` | Demo-plan schemas, safety validation, estimation, and storyboards         |
| `apps/cli/src/capture`   | Plan execution, Playwright actions, capture, and manifests                |
| `apps/cli/src/renderer`  | Asset serving, presentation overrides, and packaged Remotion MP4 output   |
| `apps/cli/src/*.ts`      | Public command adapters and package orchestration                         |
| `apps/remotion`          | React/Remotion presentation only                                          |

Keep framework-independent recording and timeline contracts in `core`, Node-only product stages as source modules inside `apps/cli`, and React/Remotion components in `apps/remotion`. Only boundaries with distinct browser or runtime reuse requirements are workspaces.

## Common commands

```bash
pnpm install
pnpm exec playwright install chromium
pnpm check
pnpm build
pnpm package:cli
pnpm test:integration
pnpm demo-recorder explore --url https://example.com
pnpm demo-recorder plan validate <demo-plan.json>
pnpm demo-recorder run <demo-plan.json>
pnpm studio:recording <recording-id-or-path>
pnpm clean
```

`pnpm check` runs linting, formatting, stable TypeScript 5.9 checks, and fast unit tests. Turbo orders and caches the three workspace typechecks and the CLI/Remotion builds. `pnpm package:cli` uses tsdown to bundle the CLI and auth daemon, then copies the prebuilt Remotion composition into ignored package assets.

## Distribution smoke test

Build the publishable package without publishing it:

```bash
pnpm package:cli
cd apps/cli
npm pack --dry-run
```

The tarball must contain `dist/cli.js`, `dist/auth-daemon.js`, and the prebuilt Remotion bundle under `assets/remotion/`, without unresolved workspace imports, tests, fixtures, or generated user state. Run `pnpm test:package` for the stronger isolated install, plan execution, recording, and MP4 render check.

## Agent-directed site workflow

Site demos use a declarative plan:

```bash
pnpm demo-recorder explore --url https://example.com
pnpm demo-recorder plan validate .demo-recorder/plans/example/demo-plan.json
pnpm demo-recorder run .demo-recorder/plans/example/demo-plan.json
```

For a local app, add `--repo`, `--start`, and `--url` during exploration, then put the same repository/start/readiness facts in the plan target. Use `skills/demo-video` when a coding agent directs the demo. See [`agent-first-workflow.md`](agent-first-workflow.md).

## Inspect a recording

A successful command prints the exact recording directory. Check:

```text
recording.json   validated capture facts and events
browser.webm     raw 1440×900 Playwright video
metadata.json    non-contract recorder diagnostics
demo-plan.json   agent-authored capture direction for plan recordings
presentation.json presentation choices kept outside the manifest
artifacts/       optional capture artifacts
```

Review `recording.json` for version, equal durations, ordered timestamps, viewport-relative coordinates, and expected event kinds. See [`recording-format.md`](recording-format.md).

Generated files are ignored by Git. Do not edit a manifest to add zooms or presentation choices.

## Preview in Remotion Studio

Preview a generated recording:

```bash
pnpm studio:recording <recording-id-or-path>
```

The command validates the recording, generates its zoom timeline, copies the WebM into ignored Studio assets, writes props, and starts Studio. Source recording files remain unchanged. `pnpm clean` removes the generated Studio assets.

## Render a final video

Render by ID under `recordings/`:

```bash
pnpm demo:render <recording-id>
```

An absolute or repository-relative recording directory or `recording.json` path is also accepted. Output defaults to:

```text
output/<recording-id>.mp4
```

The renderer validates paths, derives zoom segments, starts an exact-path loopback media server, loads the prebuilt `ProductDemo` composition, and renders H.264 at the configured dimensions and FPS.

## Tests and failure paths

Fast checks:

```bash
pnpm check
```

Browser lifecycle integration checks:

```bash
pnpm test:integration
```

Full packed-package capture and render smoke test:

```bash
pnpm test:package
```

Integration tests use `apps/cli/tests/fixtures/` and a test-only loopback server to verify server shutdown, plan recording validity, zoom generation, and cleanup after a failed browser session. The package smoke test runs the installed tarball against that fixture through the public plan workflow; test fixtures are not shipped.

## Cleanup

`pnpm clean` removes generated explorations, recordings, rendered outputs, every direct app/package `dist/` directory, the Remotion build, package assets, and generated Studio assets. It preserves `.demo-recorder/plans/` and `.demo-recorder/auth/`. Save any recording or MP4 you want to keep before cleaning; `pnpm build` or `pnpm package:cli` recreates build output.
