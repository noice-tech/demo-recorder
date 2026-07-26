# Renderer asset sources

The checked-in PNGs in the parent directory are generated deterministically by
`pnpm --filter @noice-tech/demo-recorder-ffmpeg assets` using the CSS definitions
in `scripts/generate-assets.ts` and a Playwright Chromium screenshot at device
scale factor 1.

Runtime rendering does not launch Chromium; it only reads the generated PNGs and
invokes FFmpeg.
