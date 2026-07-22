import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

export type FixtureServer = {
  baseUrl: string;
  close(): Promise<void>;
};

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

export async function startFixtureServer(rootDirectory: string): Promise<FixtureServer> {
  const root = resolve(rootDirectory);
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      if (requestUrl.pathname === "/__ready") {
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("ready");
        return;
      }

      const relativePath = decodeURIComponent(
        requestUrl.pathname === "/" ? "index.html" : requestUrl.pathname.slice(1),
      );
      const filePath = resolve(root, relativePath);
      if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }
      const fileStats = await stat(filePath);
      if (!fileStats.isFile()) throw new Error("Not a file");
      response.writeHead(200, {
        "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      createReadStream(filePath).pipe(response);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });

  await new Promise<void>((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListening();
    });
  }).catch((error: unknown) => {
    throw new Error("Fixture server failed to start", { cause: error });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Fixture server did not expose a TCP address");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const readiness = await fetch(`${baseUrl}/__ready`);
    if (!readiness.ok || (await readiness.text()) !== "ready") {
      throw new Error(`Readiness endpoint returned ${readiness.status}`);
    }
  } catch (error) {
    server.close();
    throw new Error("Fixture server readiness check failed", { cause: error });
  }

  let closed = false;
  return {
    baseUrl,
    async close() {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
      });
    },
  };
}
