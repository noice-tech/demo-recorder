import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { exploreSite, type ExplorationReport } from "../src/explorer/index.js";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe("browser exploration", () => {
  it("follows bounded same-origin links without submitting forms", async () => {
    let submissions = 0;
    const server = createServer((request, response) => {
      if (request.method === "POST") submissions += 1;
      response.setHeader("content-type", "text/html");
      response.end(
        request.url === "/second"
          ? "<h1>Second</h1>"
          : '<h1>Home</h1><a href="/second">Second page</a><form method="post"><input aria-label="Email"><button type="submit">Send</button></form>',
      );
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test address");
    const outputDirectory = await mkdtemp(join(tmpdir(), "exploration-"));
    const report = await exploreSite({
      baseUrl: `http://127.0.0.1:${address.port}`,
      outputDirectory,
      maxPages: 2,
      maxDepth: 1,
    });
    expect(report.pages.map((page) => page.headings[0])).toEqual(["Home", "Second"]);
    expect(report.pages[0]?.controls.some((control) => control.classification === "form")).toBe(
      true,
    );
    expect(submissions).toBe(0);
    const saved = JSON.parse(
      await readFile(join(outputDirectory, "exploration.json"), "utf8"),
    ) as ExplorationReport;
    expect(saved.pages).toHaveLength(2);
  });
});
