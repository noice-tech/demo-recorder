# FFmpeg product-demo prototype

## Decision

Proceed with a one-process FFmpeg renderer using:

- generated static PNGs for the background and browser shell;
- a libass-backed timed overlay script for titles, cursor, pressed state, and click rings;
- dynamic `scale=eval=frame` plus `overlay=eval=frame` for the camera;
- RGB/RGBA composition followed by one yuv420p BT.709 conversion;
- external `ffmpeg` and `ffprobe`, with `libx264` as the initial encoder.

`perspective` remains a fallback, but the complete scale/overlay render showed no
visible camera jitter in the inspected key frames and was faster in the synthetic
camera test.

## Prototype input

`recordings/2026-07-26T15-13-17-405Z-banger-template-visualizers-1d6f4522`

- VP8 WebM, 1440x900, 25 FPS, 44.32 seconds, video-only;
- 354 recording events;
- 12 automatic zoom segments;
- output target: 1920x1080, 30 FPS.

## Local results

Machine-local measurements using FFmpeg 7.1 on macOS:

| Renderer                    | Wall time | Relative to playback |
| --------------------------- | --------: | -------------------: |
| Current Remotion source CLI |   78.60 s |                1.77x |
| FFmpeg prototype            |   19.66 s |                0.44x |

The FFmpeg result was approximately 4.0x faster. The finalized prototype output
contains exactly 1330 decodable frames, reports 30/1 FPS, and has a 44.333333 s
video duration. It intentionally has no silent audio stream.

A whole-video encoded comparison against Remotion measured SSIM 0.927 and PSNR
27.68 dB. These metrics include codec, color-range, font, and antialiasing
differences. Side-by-side inspection showed matching geometry, trim, camera focal
points, titles, cursor positions, click timing, rounded clipping, and shell
layout. Remaining visible differences are mostly title/cursor rasterization,
subpixel edges, shadows, and color conversion.

Local ignored artifacts:

- `tmp/ffmpeg-prototype/product-demo.mp4`
- `tmp/ffmpeg-prototype/product-demo.contact-sheet.png`
- `tmp/ffmpeg-prototype/remotion-left-ffmpeg-right.png`
- `tmp/ffmpeg-prototype/ssim.log`
- `tmp/ffmpeg-prototype/psnr.log`

## Proven locally

- dynamic scale dimensions and moving transform origins work without graph
  reinitialization failures;
- the timed overlay script can render frame-sampled cursor/click drawings onto
  the transparent browser layer before camera transformation;
- the alpha content mask preserves rounded bottom corners;
- generated browser/background assets closely reproduce the current CSS shell;
- the required filters and both `libx264` and `h264_videotoolbox` are available
  in the tested Homebrew build.

## Version 1 constraints

- Only 1920x1080 assets and `libx264` are supported by the initial package.
- libass is required; Linux, macOS, and Windows renderer validation is configured
  in CI.
- Inter is bundled under the SIL Open Font License for deterministic title
  rendering.
- The CLI now uses this renderer and ffprobe integration; the separate Remotion
  application remains temporarily as a visual comparison oracle.
- Hardware encoders and arbitrary dimensions are intentionally outside the
  version 1 contract; cancellation and packaged assets are integrated.
