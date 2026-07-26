# FFmpeg renderer

Private renderer package for the product-demo composition. It consumes prepared
recording/timeline data and invokes user-installed `ffmpeg` and `ffprobe` as
separate processes.

The initial implementation intentionally supports 1920x1080, 30 FPS composition
assets and `libx264`. Timed overlays use libass internally, so FFmpeg must expose
its technically named `ass` filter.
