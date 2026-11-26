import { resolve } from "node:path";
import { message } from "./evidence.js";
import { finish, invoke, review, startTrial } from "./runner.js";
import { smoke } from "./smoke.js";

const usage = `pnpm eval:demo start <case> <host> <model>
pnpm eval:demo cli <trial-dir> <demo-recorder command and flags>
pnpm eval:demo finish <trial-dir> <response-file> [completed|agent-error|timeout|environment-error]
pnpm eval:demo review <trial-dir> <candidate-id|stop> <pass|fail> <note>
pnpm eval:demo smoke`;

async function start([caseId, host, model]: string[]) {
  if (!caseId || !host || !model) {
    throw new Error(usage);
  }
  const run = await startTrial(caseId, host, model, "manual");
  console.log(
    `Trial: ${run.project}\nAgent handoff: ${run.project}/brief.md\nLeave this terminal running until the agent is done. Ctrl+C stops the fixture.`,
  );
  const stop = () => {
    void run.close();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

async function main([command, dir, ...args]: string[]) {
  if (!dir) {
    if (command === "smoke") {
      return smoke();
    }
    throw new Error(usage);
  }
  if (command === "start") {
    return start([dir, ...args]);
  }
  const project = resolve(dir);
  const [first, second, third] = args;
  if (!first) {
    throw new Error(usage);
  }
  if (command === "cli") {
    const result = await invoke(project, args);
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }
  if (command === "finish" && args.length <= 2) {
    console.log(JSON.stringify(await finish(project, first, second ?? "completed"), null, 2));
    return;
  }
  if (command === "review" && second && third && args.length === 3) {
    console.log(JSON.stringify(await review(project, first, second, third), null, 2));
    return;
  }
  throw new Error(usage);
}

await main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(message(error));
  process.exitCode = 1;
});
