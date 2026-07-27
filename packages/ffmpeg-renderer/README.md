# FFmpeg renderer

Private renderer package for the product-demo composition. It consumes prepared
recording/timeline data and invokes user-installed `ffmpeg` and `ffprobe` as
separate processes.

## Version 1 capability contract

- 1920x1080 output at the configured constant frame rate (60 FPS by default);
- H.264 MP4 through `libx264`, `yuv420p`, limited-range BT.709;
- video-only output; the source recordings are muted and no synthetic audio track
  is added;
- external FFmpeg/ffprobe with capability probing rather than a fixed version;
- required filters: alpha extraction/merge, libass timed overlays, color-space
  conversion, overlay, scale, trim, FPS, and timestamp filters;
- bundled Inter font for deterministic title rendering;
- generated static browser assets designed for 1920x1080.

Hardware encoders and arbitrary output dimensions are intentionally outside the
version 1 contract. Timed overlays use libass internally, so FFmpeg must expose
its technically named `ass` filter.
