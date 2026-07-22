import { createServer } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { captureSessionStorage } from "./session-storage.js";

const [profileDirectory, descriptorPath, baseUrl, token] = process.argv.slice(2);
if (!profileDirectory || !descriptorPath || !baseUrl || !token)
  throw new Error("Invalid auth daemon arguments");

await mkdir(profileDirectory, { recursive: true });
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

let stopping = false;
const stop = async (): Promise<void> => {
  if (stopping) return;
  stopping = true;
  await rm(descriptorPath, { force: true });
  await context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
};

const server = createServer(async (request, response) => {
  if (request.headers.authorization !== `Bearer ${token}`) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  if (request.method === "POST" && request.url === "/save") {
    try {
      await context.storageState({ path: `${profileDirectory}/storage-state.json` });
      const sessionStorage = await captureSessionStorage(context);
      await writeFile(
        `${profileDirectory}/session-storage.json`,
        `${JSON.stringify(sessionStorage, null, 2)}\n`,
        { mode: 0o600 },
      );
      await writeFile(
        `${profileDirectory}/profile.json`,
        `${JSON.stringify({ version: 1, baseUrl, savedAt: new Date().toISOString() }, null, 2)}\n`,
        { mode: 0o600 },
      );
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ saved: true }));
      setImmediate(() => void stop().finally(() => server.close()));
    } catch (error) {
      response.writeHead(500).end(error instanceof Error ? error.message : String(error));
    }
    return;
  }
  if (request.method === "POST" && request.url === "/stop") {
    response.writeHead(200).end("stopping");
    setImmediate(() => void stop().finally(() => server.close()));
    return;
  }
  response.writeHead(404).end("Not found");
});

await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => resolve());
});
const address = server.address();
if (!address || typeof address === "string") throw new Error("Auth daemon has no TCP address");
await writeFile(
  descriptorPath,
  `${JSON.stringify({ version: 1, pid: process.pid, port: address.port, token, profileDirectory, baseUrl }, null, 2)}\n`,
  { mode: 0o600 },
);

browser.once("disconnected", () => {
  void stop().finally(() => server.close());
});
