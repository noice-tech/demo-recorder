import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    cli: "src/index.ts",
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
    alwaysBundle: ["@noice-tech/demo-recorder-core", "@noice-tech/demo-recorder-renderer"],
    onlyBundle: ["zod"],
  },
});
