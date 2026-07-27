import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    cli: "src/index.ts",
    "auth-daemon": "src/explorer/auth-daemon.ts",
    "exploration-daemon": "src/explorer/session-daemon.ts",
  },
  outDir: "dist",
  format: "esm",
  platform: "node",
  target: "node22",
  fixedExtension: false,
  sourcemap: true,
  clean: true,
  dts: false,
  deps: {
    alwaysBundle: ["@noice-tech/demo-recorder-core", "@noice-tech/demo-recorder-ffmpeg"],
    onlyBundle: ["zod"],
  },
});
