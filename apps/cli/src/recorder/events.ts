import type { RecordingEvent } from "@noice-tech/demo-recorder-core";

type WithoutTimestamp<Event> = Event extends { timestampMs: number }
  ? Omit<Event, "timestampMs">
  : never;

export type EventInput = WithoutTimestamp<RecordingEvent>;

export type EventLog = {
  setStep(step: number | undefined): void;
  push(event: EventInput): void;
  events(): RecordingEvent[];
};

/** Timestamped event log aligned to the first captured video frame. */
export function createEventLog(startedAtNs: bigint): EventLog {
  const captured: RecordingEvent[] = [];
  let step: number | undefined;

  const now = (): number => Number(process.hrtime.bigint() - startedAtNs) / 1_000_000;

  return {
    setStep(value) {
      step = value;
    },
    push(event) {
      captured.push({
        ...event,
        timestampMs: now(),
        ...(step === undefined ? {} : { step }),
      } as RecordingEvent);
    },
    events() {
      return captured.map((event) => ({ ...event }));
    },
  };
}
