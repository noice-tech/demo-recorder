import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { rm } from "node:fs/promises";
import type { CDPSession, Page } from "playwright";

export const recordingFps = 60;
const frameIntervalMs = 1_000 / recordingFps;
const maximumBufferedBytes = 256 * 1024 * 1024;

type ScreencastFrame = {
  data: string;
  sessionId: number;
};

export type RecordingDiagnostics = {
  recorder: "cdp-ffmpeg";
  fps: number;
  capturedFrames: number;
  emittedFrames: number;
  duplicatedFrames: number;
  droppedFrames: number;
  maximumSourceGapMs: number;
  maximumEncoderBufferBytes: number;
};

export type CdpRecorder = {
  startedAtNs: bigint;
  stop(): Promise<RecordingDiagnostics>;
  abort(): Promise<void>;
};

export function targetFrameCount(elapsedMs: number, fps = recordingFps): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0)
    throw new Error("Elapsed time must be non-negative");
  if (!Number.isInteger(fps) || fps <= 0) throw new Error("Recording FPS must be positive");
  const elapsedFrames = (elapsedMs * fps) / 1_000;
  return Math.max(1, Math.ceil(elapsedFrames - 1e-9));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function waitForSpawn(child: ChildProcessWithoutNullStreams): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
}

export async function startCdpRecorder(options: {
  page: Page;
  outputPath: string;
  width: number;
  height: number;
  ffmpegPath?: string;
}): Promise<CdpRecorder> {
  const ffmpegPath = options.ffmpegPath ?? process.env.DEMO_RECORDER_FFMPEG ?? "ffmpeg";
  const child = spawn(
    ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "image2pipe",
      "-framerate",
      String(recordingFps),
      "-vcodec",
      "mjpeg",
      "-i",
      "pipe:0",
      "-an",
      "-vf",
      "pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "12",
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(recordingFps),
      "-fps_mode",
      "cfr",
      "-movflags",
      "+faststart",
      "-y",
      options.outputPath,
    ],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );

  child.stdout.resume();
  let stderr = "";
  let encoderError: Error | undefined;
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
    if (stderr.length > 100_000) stderr = stderr.slice(-100_000);
  });
  child.stdin.on("error", (error) => {
    encoderError = error;
  });
  const closed = new Promise<void>((resolve, reject) => {
    let processError: Error | undefined;
    child.once("error", (error) => {
      processError = error;
    });
    child.once("close", (code, signal) => {
      if (processError) reject(processError);
      else if (code === 0) resolve();
      else {
        const reason = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
        reject(new Error(`${ffmpegPath} failed with ${reason}: ${stderr.slice(-4_000).trim()}`));
      }
    });
  });

  try {
    await waitForSpawn(child);
  } catch (error) {
    await closed.catch(() => undefined);
    await rm(options.outputPath, { force: true });
    throw new Error(`Unable to start FFmpeg recorder: ${message(error)}`, { cause: error });
  }

  let cdp: CDPSession;
  try {
    cdp = await options.page.context().newCDPSession(options.page);
  } catch (error) {
    child.kill("SIGKILL");
    await closed.catch(() => undefined);
    await rm(options.outputPath, { force: true });
    throw new Error("Unable to create a Chromium CDP session", { cause: error });
  }
  let startedAtNs: bigint | undefined;
  let lastSourceAtNs: bigint | undefined;
  let latestFrame: { buffer: Buffer; sequence: number } | undefined;
  let lastEmittedSequence = 0;
  let capturedFrames = 0;
  let emittedFrames = 0;
  let duplicatedFrames = 0;
  let droppedFrames = 0;
  let maximumSourceGapMs = 0;
  let maximumEncoderBufferBytes = 0;
  let timer: NodeJS.Timeout | undefined;
  let active = true;
  let resolveFirstFrame: (() => void) | undefined;
  const firstFrame = new Promise<void>((resolve) => {
    resolveFirstFrame = resolve;
  });

  const emitUntil = (count: number): void => {
    if (!latestFrame) return;
    while (emittedFrames < count) {
      if (latestFrame.sequence === lastEmittedSequence) duplicatedFrames += 1;
      else if (lastEmittedSequence > 0 && latestFrame.sequence > lastEmittedSequence + 1)
        droppedFrames += latestFrame.sequence - lastEmittedSequence - 1;
      child.stdin.write(latestFrame.buffer);
      emittedFrames += 1;
      lastEmittedSequence = latestFrame.sequence;
      maximumEncoderBufferBytes = Math.max(maximumEncoderBufferBytes, child.stdin.writableLength);
      if (child.stdin.writableLength > maximumBufferedBytes) {
        encoderError = new Error(
          `FFmpeg encoder fell behind by more than ${maximumBufferedBytes / 1024 / 1024} MiB`,
        );
        return;
      }
    }
  };

  const scheduleFrames = (): void => {
    if (!active || startedAtNs === undefined || encoderError) return;
    const elapsedMs = Number(process.hrtime.bigint() - startedAtNs) / 1_000_000;
    emitUntil(targetFrameCount(elapsedMs));
    timer = setTimeout(scheduleFrames, Math.max(1, frameIntervalMs / 2));
    timer.unref();
  };

  const onFrame = (frame: ScreencastFrame): void => {
    const receivedAtNs = process.hrtime.bigint();
    capturedFrames += 1;
    latestFrame = { buffer: Buffer.from(frame.data, "base64"), sequence: capturedFrames };
    if (lastSourceAtNs !== undefined) {
      maximumSourceGapMs = Math.max(
        maximumSourceGapMs,
        Number(receivedAtNs - lastSourceAtNs) / 1_000_000,
      );
    }
    lastSourceAtNs = receivedAtNs;
    if (startedAtNs === undefined) {
      startedAtNs = receivedAtNs;
      emitUntil(1);
      resolveFirstFrame?.();
      scheduleFrames();
    }
    void cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch((error) => {
      if (active) encoderError = new Error(`Unable to acknowledge CDP frame: ${message(error)}`);
    });
  };

  cdp.on("Page.screencastFrame", onFrame);
  try {
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 90,
      maxWidth: options.width,
      maxHeight: options.height,
      everyNthFrame: 1,
    });
    await Promise.race([
      firstFrame,
      options.page.waitForTimeout(5_000).then(() => {
        throw new Error("Timed out waiting for the first CDP screencast frame");
      }),
    ]);
  } catch (error) {
    active = false;
    if (timer) clearTimeout(timer);
    cdp.off("Page.screencastFrame", onFrame);
    await cdp.send("Page.stopScreencast").catch(() => undefined);
    await cdp.detach().catch(() => undefined);
    child.kill("SIGKILL");
    await closed.catch(() => undefined);
    await rm(options.outputPath, { force: true });
    throw new Error("Unable to start CDP recording", { cause: error });
  }

  if (startedAtNs === undefined) throw new Error("CDP recording did not establish a video clock");
  const recordingStartedAtNs = startedAtNs;
  let finalized = false;
  const cleanupCdp = async (): Promise<void> => {
    active = false;
    if (timer) clearTimeout(timer);
    await cdp.send("Page.stopScreencast").catch(() => undefined);
    cdp.off("Page.screencastFrame", onFrame);
    await cdp.detach().catch(() => undefined);
  };

  return {
    startedAtNs: recordingStartedAtNs,
    async stop() {
      if (finalized) throw new Error("CDP recorder has already been finalized");
      finalized = true;
      const stoppedAtNs = process.hrtime.bigint();
      await cleanupCdp();
      emitUntil(targetFrameCount(Number(stoppedAtNs - recordingStartedAtNs) / 1_000_000));
      if (encoderError) {
        child.kill("SIGKILL");
        await closed.catch(() => undefined);
        await rm(options.outputPath, { force: true });
        throw encoderError;
      }
      child.stdin.end();
      try {
        await closed;
      } catch (error) {
        await rm(options.outputPath, { force: true });
        throw error;
      }
      return {
        recorder: "cdp-ffmpeg",
        fps: recordingFps,
        capturedFrames,
        emittedFrames,
        duplicatedFrames,
        droppedFrames,
        maximumSourceGapMs,
        maximumEncoderBufferBytes,
      };
    },
    async abort() {
      if (finalized) return;
      finalized = true;
      await cleanupCdp();
      child.kill("SIGKILL");
      await closed.catch(() => undefined);
      await rm(options.outputPath, { force: true });
    },
  };
}
