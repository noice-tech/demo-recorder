# Recording Format

Each successful capture creates:

```text
recordings/<recording-id>/
├── recording.json
├── browser.mp4
├── metadata.json
├── demo-plan.json       # present for plan-driven recordings
├── presentation.json    # present for plan-driven recordings
└── artifacts/
```

`recording.json` is the versioned contract between Chromium capture and timeline/render processing. `metadata.json` is optional diagnostics and is not part of that contract. Plan-driven captures also preserve the validated plan and presentation direction as separate, non-manifest files.

## Versions

Version 1 contains navigation, cursor movement, and click events. Version 2 keeps those fields and adds explicit keyboard press events. New captures use version 2; the renderer remains compatible with existing version 1 recordings.

```json
{
  "version": 2,
  "id": "2026-07-19T15-24-31-765Z-homepage-overview-bf2869d8",
  "createdAt": "2026-07-19T15:24:31.900Z",
  "durationMs": 6720,
  "viewport": { "width": 1440, "height": 900 },
  "video": {
    "path": "browser.mp4",
    "width": 1440,
    "height": 900,
    "durationMs": 6720
  },
  "events": []
}
```

Unknown versions are rejected. New incompatible contracts require a new version and parser behavior rather than silently changing version 1.

## Timeline origin and duration

The logical timeline begins at `0` with the first recorded CDP screencast frame. All event timestamps are milliseconds on that same video-aligned clock and are stored in nondecreasing order.

In both versions, `durationMs` must equal `video.durationMs`; both describe the source video timeline. Events may occur exactly at the duration but never after it.

## Coordinates

Cursor and click coordinates are finite CSS-pixel points relative to the recorded browser viewport:

```text
(0, 0) ─────────────── x
  │
  │       viewport
  │
  y
```

Both edges are inclusive:

```text
0 <= x <= viewport.width
0 <= y <= viewport.height
```

Optional target bounds use the same viewport coordinate space but may extend outside it when the DOM element is clipped. Render code projects source points through core's contained-video transform before drawing overlays.

## Event types

### Navigation

```json
{ "type": "navigation", "timestampMs": 210, "url": "http://127.0.0.1:54883/" }
```

The URL is the observed main-frame destination.

### Cursor movement

```json
{ "type": "cursor-move", "timestampMs": 600, "x": 32, "y": 32 }
```

Instrumented movement emits deterministic, frame-sampled points that can be interpolated by the composition. The first movement event establishes the synthetic cursor's initial position, and subsequent events preserve the curved capture trajectory.

### Click

```json
{
  "type": "click",
  "timestampMs": 2024,
  "x": 1299.9,
  "y": 41.5,
  "button": "left",
  "target": {
    "role": "button",
    "name": "Create project",
    "bounds": { "x": 1228, "y": 20, "width": 144, "height": 43 }
  }
}
```

`target` is best-effort semantic capture metadata. It is optional; coordinates and button are authoritative for rendering.

### Keyboard press (version 2)

```json
{
  "type": "key-press",
  "timestampMs": 2420,
  "keys": ["Meta", "K"]
}
```

`keys` stores the canonical chord actually dispatched by the capture host, with modifiers in canonical order followed by at most one ordinary key. Host-dependent `ControlOrMeta` is resolved to `Meta` on macOS and `Control` elsewhere before it reaches the manifest.

Only explicit plan `press` actions create keyboard events. Global presses use the page's current focus; targeted presses may retain a locator. Fill values and arbitrary physical/page keyboard activity are deliberately not observed or recorded, preventing typed values and passwords from leaking into the manifest or overlay.

The renderer presents keyboard events as a lower-center, Screen Studio-style HUD. It is composed after the camera transform, so zooms do not move or scale it. Consecutive events replace the previous chord.

Version 1 records only navigation, cursor movement, and click events. Fill, selection, scroll, visibility checks, and waits remain visible in the source video where applicable but do not add manifest events.

## Source video relationship

`video.path` is relative to the manifest directory. The renderer rejects absolute paths, traversal, missing files, and symlinks resolving outside that directory. Width and height are measured from the finalized 60 FPS H.264 source, not estimated from configuration. The source is constant-frame-rate; when Chromium supplies fewer than 60 unique paints per second, the recorder repeats the latest frame to preserve real-time duration and the 60 FPS contract.

The native browser cursor is hidden during capture. The final cursor and click response are reconstructed from events.

## Immutable facts versus presentation

The manifest records what was captured. It must not contain derived decisions such as:

- click clusters or zoom segments;
- camera interpolation;
- browser-frame padding;
- trimming;
- output dimensions or styling.

Those belong in `DemoTimeline` and render configuration. This separation permits repeated presentation changes without mutating or replaying the source recording.

The Safari-inspired browser frame uses the dark theme by default. A plan or saved `presentation.json` can request the light variant without recapturing:

```json
{
  "browserFrame": { "theme": "light" }
}
```

Supported themes are `dark` and `light`.
