const SETTLE_POLL_MS = 50;
const SETTLE_TIMEOUT_MS = 1_500;

/**
 * Waits for an asynchronous change (such as wheel scrolling, which may not have
 * started yet) to move a value away from `before` and then hold still for one
 * poll. If nothing moves before the timeout, returns the last value read.
 * Returns undefined as soon as the value disappears.
 */
export async function settleAfterChange<Value>(input: {
  before: Value;
  read: () => Promise<Value | undefined>;
  same: (left: Value, right: Value) => boolean;
  wait: (durationMs: number) => Promise<void>;
  pollMs?: number;
  timeoutMs?: number;
}): Promise<Value | undefined> {
  const pollMs = input.pollMs ?? SETTLE_POLL_MS;
  const timeoutMs = input.timeoutMs ?? SETTLE_TIMEOUT_MS;
  let previous: Value | undefined;
  let moved = false;
  for (let elapsed = 0; elapsed < timeoutMs; elapsed += pollMs) {
    await input.wait(pollMs);
    const current = await input.read();
    if (current === undefined) {
      return undefined;
    }
    moved ||= !input.same(current, input.before);
    if (moved && previous !== undefined && input.same(previous, current)) {
      return current;
    }
    previous = current;
  }
  return previous;
}
