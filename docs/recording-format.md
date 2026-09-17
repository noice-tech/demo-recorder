# Recording Format

Each successful capture creates:

```text
<project>/
├── recording/
│   ├── browser.mp4
│   └── events.json
├── presentation.json   # optional styling, separate from capture
└── output.mp4          # rendered deliverable
```

`recording/events.json` is the versioned contract between capture and rendering.
`record --project DIR` writes this layout; `render --project DIR` reads it and
writes `DIR/output.mp4`. Pass `--overwrite` to replace a rendered output.

For compatibility, rendering also accepts an explicit recording directory or a
manifest file and recognizes the old `recording.json` filename when `events.json`
is absent. This is filename compatibility, not conversion of old schemas. Bare
recording ids are no longer resolved under a global `recordings/` directory.

## Shape

```json
{
  "version": 1,
  "id": "2026-09-13T10-10-00-def67890",
  "createdAt": "2026-09-13T10:10:00.000Z",
  "durationMs": 14233,
  "viewport": { "width": 1440, "height": 900 },
  "guarded": true,
  "cursor": "synthetic",
  "video": { "path": "browser.mp4", "width": 1440, "height": 900 },
  "events": []
}
```

- `durationMs` is the capture duration; there is no nested `video.durationMs` field.
- `guarded` records whether the runtime safety boundary was active.
- `cursor` is `synthetic` when the renderer draws the pointer, or `embedded` when
  the video already contains one.
- Unknown top-level versions are rejected.

## Timeline

The timeline starts at `0` with the first captured frame. Event timestamps are
milliseconds on that clock, in nondecreasing order, and never after `durationMs`.

## Coordinates

Cursor and click coordinates are CSS pixels relative to the viewport. Both edges
are inclusive: `0 <= x <= width` and `0 <= y <= height`.

## Events

Five event types. Each carries a `step` when a plan step caused it.

### navigation

```json
{ "type": "navigation", "timestampMs": 210, "step": 1, "url": "http://127.0.0.1:54883/" }
```

### cursor-move

```json
{ "type": "cursor-move", "timestampMs": 600, "step": 2, "x": 32, "y": 32 }
```

### click

```json
{
  "type": "click",
  "timestampMs": 2024,
  "step": 3,
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

`target` is best-effort semantic metadata. Coordinates and button are
authoritative for rendering.

### key-press

```json
{ "type": "key-press", "timestampMs": 2420, "step": 4, "keys": ["Meta", "K"] }
```

Only explicit key actions produce key events. Fill values and arbitrary page
typing are omitted from the event log. This does not redact screenshots, video,
or URLs: avoid showing secrets during capture and review artifacts before sharing.

### scroll

```json
{ "type": "scroll", "timestampMs": 3100, "step": 5, "deltaX": 0, "deltaY": 480 }
```

Event types are additive: a reader must ignore unknown types and must reject an
unknown top-level version.

## Immutable facts versus presentation

The recording records what happened. Zooms, trim, padding, and styling belong in
`presentation.json`. Presentation anchors to plan steps rather than absolute
times, so changing direction never rewrites the capture and a re-record still
frames the right actions.
