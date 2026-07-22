import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  defaultConfig,
  generateZoomSegments,
  loadRecordingManifest,
  type ProductDemoInput,
  type RecordingManifest,
} from "@noice-tech/demo-recorder-core";
import { plannedZoomSchema } from "../demo-plan/index.js";

export type PreparedRecording = {
  manifestPath: string;
  recordingDirectory: string;
  videoPath: string;
  manifest: RecordingManifest;
  input: Omit<ProductDemoInput, "videoUrl">;
};

export type AssetServer = {
  videoUrl: string;
  close(): Promise<void>;
};

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

export async function prepareRecording(recordingPath: string): Promise<PreparedRecording> {
  const resolvedInput = resolve(recordingPath);
  const inputStats = await stat(resolvedInput).catch((error: unknown) => {
    throw new Error(`Recording path does not exist: ${resolvedInput}`, { cause: error });
  });
  const manifestPath = inputStats.isDirectory()
    ? join(resolvedInput, "recording.json")
    : resolvedInput;
  const recordingDirectory = await realpath(dirname(manifestPath));
  const manifest = await loadRecordingManifest(manifestPath);

  if (isAbsolute(manifest.video.path)) {
    throw new Error("Recording video path must be relative to recording.json");
  }

  const unresolvedVideoPath = resolve(recordingDirectory, manifest.video.path);
  if (!isInside(recordingDirectory, unresolvedVideoPath)) {
    throw new Error(`Recording video path escapes its directory: ${manifest.video.path}`);
  }

  const videoPath = await realpath(unresolvedVideoPath).catch((error: unknown) => {
    throw new Error(`Recording video is missing: ${unresolvedVideoPath}`, { cause: error });
  });
  if (!isInside(recordingDirectory, videoPath)) {
    throw new Error(`Recording video resolves outside its directory: ${manifest.video.path}`);
  }
  const videoStats = await stat(videoPath);
  if (!videoStats.isFile()) throw new Error(`Recording video is not a file: ${videoPath}`);

  const automaticZoomSegments = generateZoomSegments(
    manifest.events,
    manifest.durationMs,
    defaultConfig.zoom,
  );
  const presentationPath = join(recordingDirectory, "presentation.json");
  const presentationValue = await readFile(presentationPath, "utf8")
    .then(
      (text) =>
        JSON.parse(text) as {
          zoomSegments?: unknown[];
          trimStartMs?: unknown;
          trimEndMs?: unknown;
        },
    )
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw new Error(`Unable to read presentation plan: ${presentationPath}`, { cause: error });
    });
  const plannedZoomSegments = presentationValue?.zoomSegments?.map((segment) =>
    plannedZoomSchema.parse(segment),
  );
  if (
    plannedZoomSegments?.some(
      (segment) =>
        segment.endMs > manifest.durationMs ||
        segment.focusX > manifest.viewport.width ||
        segment.focusY > manifest.viewport.height,
    )
  ) {
    throw new Error("Presentation zoom segment is outside the recording timeline or viewport");
  }
  const zoomSegments = plannedZoomSegments ?? automaticZoomSegments;
  const trimStartMs = presentationValue?.trimStartMs ?? 0;
  const trimEndMs = presentationValue?.trimEndMs ?? manifest.durationMs;
  if (
    typeof trimStartMs !== "number" ||
    !Number.isFinite(trimStartMs) ||
    trimStartMs < 0 ||
    typeof trimEndMs !== "number" ||
    !Number.isFinite(trimEndMs) ||
    trimEndMs > manifest.durationMs ||
    trimEndMs <= trimStartMs
  ) {
    throw new Error("Presentation trim range is outside the recording timeline");
  }

  return {
    manifestPath,
    recordingDirectory,
    videoPath,
    manifest,
    input: {
      recording: manifest,
      timeline: {
        zoomSegments,
        ...(trimStartMs === 0 ? {} : { trimStartMs }),
        ...(trimEndMs === manifest.durationMs ? {} : { trimEndMs }),
      },
      config: {
        ...defaultConfig.render,
        cursorEnabled: defaultConfig.cursor.enabled,
        zoom: {
          enterDurationMs: defaultConfig.zoom.enterDurationMs,
          exitDurationMs: defaultConfig.zoom.exitDurationMs,
        },
      },
    },
  };
}

function parseRange(rangeHeader: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) return null;
  const [, startText = "", endText = ""] = match;
  if (!startText && !endText) return null;

  let start: number;
  let end: number;
  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
  if (start < 0 || start >= size || end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}

export async function startAssetServer(videoPath: string): Promise<AssetServer> {
  const videoStats = await stat(videoPath);
  const token = encodeURIComponent(basename(videoPath));
  const pathname = `/assets/${token}`;
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (
      requestUrl.pathname !== pathname ||
      !["GET", "HEAD", "OPTIONS"].includes(request.method ?? "")
    ) {
      response.writeHead(404).end("Not found");
      return;
    }

    const commonHeaders = {
      "accept-ranges": "bytes",
      "access-control-allow-headers": "range",
      "access-control-allow-methods": "GET, HEAD, OPTIONS",
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "content-length, content-range",
      "cache-control": "no-store",
      "content-type": "video/webm",
    };
    if (request.method === "OPTIONS") {
      response.writeHead(204, commonHeaders).end();
      return;
    }
    const rangeHeader = request.headers.range;
    if (rangeHeader) {
      const range = parseRange(rangeHeader, videoStats.size);
      if (!range) {
        response.writeHead(416, {
          ...commonHeaders,
          "content-range": `bytes */${videoStats.size}`,
        });
        response.end();
        return;
      }
      response.writeHead(206, {
        ...commonHeaders,
        "content-length": range.end - range.start + 1,
        "content-range": `bytes ${range.start}-${range.end}/${videoStats.size}`,
      });
      if (request.method === "HEAD") response.end();
      else createReadStream(videoPath, range).pipe(response);
      return;
    }

    response.writeHead(200, { ...commonHeaders, "content-length": videoStats.size });
    if (request.method === "HEAD") response.end();
    else createReadStream(videoPath).pipe(response);
  });

  await new Promise<void>((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListening();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Asset server did not expose a TCP address");
  }

  let closed = false;
  return {
    videoUrl: `http://127.0.0.1:${address.port}${pathname}`,
    async close() {
      if (closed) return;
      closed = true;
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
      });
    },
  };
}
