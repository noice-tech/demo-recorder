import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { activeSchema, appendJson, readJson, signalKind } from "./evidence.js";

const fixture = fileURLToPath(
  new URL("../../apps/cli/tests/fixtures/example-app/", import.meta.url),
);
const probe = new URL("./fixture-probe.js", import.meta.url);
const types = new Map([
  [".html", "text/html"],
  [".js", "text/javascript"],
  [".css", "text/css"],
]);
const assets = new Set(["app.js", "styles.css", "partner.html", "index.html"]);

/** Instrument the eval copy at serve time. Nothing is added to the shipped CLI or fixture tests. */
export async function serveTrial(project: string, page: string) {
  const script = await readFile(probe, "utf8");
  const tokens = new Map<string, string>();
  async function pageWithProbe(path: string) {
    const body = await readFile(join(fixture, path), "utf8");
    if (path !== page) {
      return body;
    }
    const active = await readJson(join(project, "active.json"), activeSchema).catch(
      () => undefined,
    );
    if (!active) {
      return body;
    }
    tokens.set(active.id, active.command);
    return body.replace(
      "</body>",
      `<script src="/__eval_probe.js?id=${active.id}"></script></body>`,
    );
  }
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const path = url.pathname.slice(1);
      response.setHeader("Cache-Control", "no-store");
      if (request.method === "POST" && path === "__eval_event") {
        const id = url.searchParams.get("id") ?? "";
        const command = tokens.get(id);
        const kind = signalKind.safeParse(url.searchParams.get("kind"));
        if (command && kind.success) {
          await appendJson(join(project, "signals.jsonl"), {
            id,
            command,
            kind: kind.data,
            at: Date.now(),
          });
          response.writeHead(204).end();
          return;
        }
      } else if (request.method === "GET") {
        if (path === "__eval_probe.js") {
          response.writeHead(200, { "Content-Type": "text/javascript" }).end(script);
          return;
        }
        if (path === "__eval_health") {
          response.writeHead(200).end(project);
          return;
        }
        if (path === page || assets.has(path)) {
          const body = await pageWithProbe(path);
          response
            .writeHead(200, { "Content-Type": types.get(extname(path)) ?? "text/plain" })
            .end(body);
          return;
        }
      }
      response.writeHead(404).end();
    } catch {
      response.writeHead(500).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fixture has no loopback address");
  }
  return {
    url: `http://127.0.0.1:${address.port}/${page}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

export async function checkFixture(project: string, url: string): Promise<void> {
  const response = await fetch(new URL("/__eval_health", url), {
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok || (await response.text()) !== project) {
    throw new Error("The trial fixture is unavailable. Leave the start command running.");
  }
}
