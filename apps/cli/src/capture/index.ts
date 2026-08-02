export {
  generateCursorPath,
  targetPointWithinBounds,
  type CursorBounds,
  type CursorPoint,
  type CursorViewport,
} from "./cursor-motion.js";
export { createRecordingBrowser } from "./create-browser.js";
export { executeDemoPlan, recordDemoPlan, resolvePlanLocator } from "./plan.js";
export { createRecordingSession } from "./session.js";
export type {
  ClickOptions,
  DemoActions,
  FillOptions,
  MoveOptions,
  RecordingSession,
  RecordingSessionOptions,
  WaitForOptions,
} from "./types.js";
