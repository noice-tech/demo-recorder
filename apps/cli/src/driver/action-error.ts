import { stripVTControlCharacters } from "node:util";

export const ACTION_TIMEOUT_MS = 5_000;

const COVERED = /^(<.+?>)(?:.*?<\/\w+>)?(?: from (<.+?>).*? subtree)? intercepts pointer events$/;
const NOT_ACTIONABLE =
  /^element (?:is not \w+|is outside of the viewport|was detached from the DOM)/;

function openingTag(html: string): string {
  const tag = /^<[^>]*>/.exec(html)?.[0] ?? html;
  return tag.length > 120 ? `${tag.slice(0, 117)}…>` : tag;
}

/** The last reason Playwright's call log gives for not acting. */
function reasonFrom(callLog: string): string | undefined {
  let reason: string | undefined;
  for (const raw of callLog.split("\n")) {
    const line = raw.trim().replace(/^- /, "");
    const covered = COVERED.exec(line);
    if (covered?.[1]) {
      reason = `covered by ${openingTag(covered[2] ?? covered[1])}`;
    } else {
      reason = NOT_ACTIONABLE.exec(line)?.[0] ?? reason;
    }
  }
  return reason;
}

export class ActionError extends Error {
  readonly verb: string;
  readonly reason: string;
  readonly callLog: string;

  constructor(verb: string, subject: string, reason: string, callLog: string) {
    super(`Could not ${verb} ${subject} within ${ACTION_TIMEOUT_MS}ms: ${reason}`);
    this.name = "ActionError";
    this.verb = verb;
    this.reason = reason;
    this.callLog = callLog;
  }

  about(subject: string): ActionError {
    return new ActionError(this.verb, subject, this.reason, this.callLog);
  }
}

/** Turns a Playwright actionability timeout into an ActionError; other errors pass through. */
export function actionFailure(error: unknown, verb: string, subject: string): unknown {
  if (!(error instanceof Error) || error.name !== "TimeoutError") {
    return error;
  }
  const [, log = ""] = stripVTControlCharacters(error.message).split("\nCall log:\n");
  const callLog = log.trimEnd();
  return new ActionError(verb, subject, reasonFrom(callLog) ?? "it never became ready", callLog);
}
