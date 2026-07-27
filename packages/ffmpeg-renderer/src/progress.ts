export type FfmpegProgress = {
  outTimeMs: number;
  progress?: string;
};

export function createProgressParser(onProgress: (value: FfmpegProgress) => void) {
  let buffered = "";
  let current: FfmpegProgress = { outTimeMs: 0 };
  return (chunk: string | Buffer): void => {
    buffered += chunk.toString();
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      const separator = line.indexOf("=");
      if (separator < 0) continue;
      const key = line.slice(0, separator);
      const value = line.slice(separator + 1);
      if (key === "out_time_us" || key === "out_time_ms") {
        const microseconds = Number(value);
        if (Number.isFinite(microseconds)) current.outTimeMs = microseconds / 1000;
      }
      if (key === "progress") {
        current.progress = value;
        onProgress(current);
        current = { outTimeMs: current.outTimeMs };
      }
    }
  };
}
