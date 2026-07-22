import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Config } from "@remotion/cli/config";

const rootPublicDirectory = resolve(process.cwd(), "apps/remotion/public");
const publicDirectory = existsSync(rootPublicDirectory)
  ? rootPublicDirectory
  : resolve(process.cwd(), "public");

Config.setPublicDir(publicDirectory);
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.overrideWebpackConfig((current) => ({
  ...current,
  devtool: false,
  resolve: {
    ...current.resolve,
    extensionAlias: {
      ...current.resolve?.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    },
  },
}));
