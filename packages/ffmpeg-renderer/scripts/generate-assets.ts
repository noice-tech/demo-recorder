import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { defaultConfig } from "@noice-tech/demo-recorder-core";
import { productDemoGeometry } from "../src/product-demo/geometry.js";

const assetsDirectory = fileURLToPath(new URL("../assets/", import.meta.url));
const output = defaultConfig.render;
const geometry = productDemoGeometry(defaultConfig.recording.viewport, output);
await mkdir(assetsDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: output, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
    .frame { position: absolute; left: ${geometry.browser.x}px; top: ${geometry.browser.y}px; width: ${geometry.browser.width}px; height: ${geometry.browser.height}px; border-radius: 20px; background: #111522; box-shadow: 0 34px 90px rgba(0,0,0,0.48); }
  </style><div class="frame"></div>`);
  await page.screenshot({
    path: `${assetsDirectory}/browser-underlay.png`,
    type: "png",
    omitBackground: true,
  });

  await page.setContent(`<!doctype html><style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
    .frame { position: absolute; left: ${geometry.browser.x}px; top: ${geometry.browser.y}px; width: ${geometry.browser.width}px; height: ${geometry.browser.height}px; overflow: hidden; border: 1px solid rgba(255,255,255,0.14); border-radius: 20px; }
    .bar { height: 48px; display: flex; align-items: center; padding: 0 18px; background: linear-gradient(180deg, #242a39 0%, #1a1f2c 100%); border-bottom: 1px solid rgba(255,255,255,0.08); }
    .controls { display: flex; gap: 9px; }
    .control { width: 12px; height: 12px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.15); }
  </style><div class="frame"><div class="bar"><div class="controls"><i class="control" style="background:#ff5f57"></i><i class="control" style="background:#febc2e"></i><i class="control" style="background:#28c840"></i></div></div></div>`);
  await page.screenshot({
    path: `${assetsDirectory}/browser-overlay.png`,
    type: "png",
    omitBackground: true,
  });

  await page.setViewportSize({ width: geometry.content.width, height: geometry.content.height });
  await page.setContent(`<!doctype html><style>
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
    .mask { width: 100%; height: 100%; background: white; border-radius: 0 0 20px 20px; }
  </style><div class="mask"></div>`);
  await page.screenshot({
    path: `${assetsDirectory}/content-mask.png`,
    type: "png",
    omitBackground: true,
  });
} finally {
  await browser.close();
}

console.log(`[ffmpeg-renderer] Generated assets in ${assetsDirectory}`);
