import type { RecordingEvent } from "@noice-tech/demo-recorder-core";

type WithoutTimestamp<Event> = Event extends { timestampMs: number }
  ? Omit<Event, "timestampMs">
  : never;

type CapturedEvent = WithoutTimestamp<RecordingEvent>;

export type InteractionTracker = {
  now(): number;
  push(event: CapturedEvent): void;
  events(): RecordingEvent[];
};

export function createInteractionTracker(startedAtNs: bigint): InteractionTracker {
  const captured: RecordingEvent[] = [];

  const now = (): number => Number(process.hrtime.bigint() - startedAtNs) / 1_000_000;

  return {
    now,
    push(event) {
      const timestampMs = now();
      if (event.type === "navigation") {
        const previous = captured.at(-1);
        if (previous?.type === "navigation" && previous.url === event.url) return;
      }
      captured.push({ ...event, timestampMs } as RecordingEvent);
    },
    events() {
      return captured.map((event) => ({ ...event }));
    },
  };
}
