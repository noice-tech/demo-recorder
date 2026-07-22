import {
  defaultConfig,
  generateZoomSegments,
  type ProductDemoInput,
  type RecordingManifest,
} from "@noice-tech/demo-recorder-core/browser";
import { Composition, staticFile, type CalculateMetadataFunction } from "remotion";
import { ProductDemo, productDemoInputSchema } from "./compositions/ProductDemo/index.js";

const sampleRecording: RecordingManifest = {
  version: 1,
  id: "studio-example",
  createdAt: "2026-07-19T14:48:15.368Z",
  durationMs: 6640,
  viewport: { width: 1440, height: 900 },
  video: { path: "sample-browser.webm", width: 1440, height: 900, durationMs: 6640 },
  events: [
    { type: "navigation", timestampMs: 210, url: "http://example.local/" },
    { type: "cursor-move", timestampMs: 600, x: 32, y: 32 },
    { type: "cursor-move", timestampMs: 1950, x: 1299.921875, y: 41.5 },
    { type: "click", timestampMs: 2024, x: 1299.921875, y: 41.5, button: "left" },
    { type: "cursor-move", timestampMs: 3800, x: 403.5, y: 479.96875 },
    { type: "click", timestampMs: 3889, x: 403.5, y: 479.96875, button: "left" },
    { type: "cursor-move", timestampMs: 5650, x: 1250, y: 680.171875 },
    { type: "click", timestampMs: 5736, x: 1250, y: 680.171875, button: "left" },
  ],
};

const defaultProps: ProductDemoInput = {
  recording: sampleRecording,
  videoUrl: staticFile("sample-browser.webm"),
  timeline: {
    zoomSegments: generateZoomSegments(
      sampleRecording.events,
      sampleRecording.durationMs,
      defaultConfig.zoom,
    ),
  },
  config: {
    ...defaultConfig.render,
    cursorEnabled: defaultConfig.cursor.enabled,
    zoom: {
      enterDurationMs: defaultConfig.zoom.enterDurationMs,
      exitDurationMs: defaultConfig.zoom.exitDurationMs,
    },
  },
};

const calculateMetadata: CalculateMetadataFunction<ProductDemoInput> = ({ props }) => {
  const parsed = productDemoInputSchema.parse(props) as ProductDemoInput;
  return {
    props: parsed,
    width: parsed.config.width,
    height: parsed.config.height,
    fps: parsed.config.fps,
    durationInFrames: Math.max(
      1,
      Math.ceil(
        (((parsed.timeline.trimEndMs ?? parsed.recording.durationMs) -
          (parsed.timeline.trimStartMs ?? 0)) /
          1000) *
          parsed.config.fps,
      ),
    ),
  };
};

export function RemotionRoot() {
  return (
    <Composition
      id="ProductDemo"
      component={ProductDemo}
      schema={productDemoInputSchema}
      width={defaultProps.config.width}
      height={defaultProps.config.height}
      fps={defaultProps.config.fps}
      durationInFrames={Math.ceil(
        (defaultProps.recording.durationMs / 1000) * defaultProps.config.fps,
      )}
      defaultProps={defaultProps}
      calculateMetadata={calculateMetadata}
    />
  );
}
