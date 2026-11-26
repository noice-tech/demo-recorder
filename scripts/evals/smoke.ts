import { strict as assert } from "node:assert";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { writeJson } from "./evidence.js";
import { finish, invoke, startTrial } from "./runner.js";

/** Scripted cases test the pipeline, not the skill or a model. Never use as baseline trials. */
export async function smoke() {
  for (const variant of ["reviews", "wrong-video", "covered-control"] as const) {
    const run = await startTrial(
      variant === "wrong-video" ? "reviews" : variant,
      "scripted",
      "none",
      "smoke",
    );
    const { project, trial } = run;
    console.log(`${variant}: ${project}`);
    try {
      const blocked = variant === "covered-control";
      const steps = blocked
        ? [{ type: "click", target: { role: "button", name: "Start trial" } }]
        : [
            { type: "hold", durationMs: 1100 },
            variant === "reviews"
              ? { type: "scroll", to: { role: "heading", name: "Owners' reviews" } }
              : { type: "scroll", deltaY: 120 },
            { type: "hold", durationMs: 1500 },
          ];
      await writeJson(join(project, "plan.json"), {
        version: 1,
        name: variant,
        goal: trial.case.brief,
        target: { baseUrl: trial.url },
        viewport: { width: 1280, height: 720 },
        steps,
      });
      const rehearsed = await invoke(project, ["plan", "rehearse"]);
      assert.equal(rehearsed.ok, !blocked, rehearsed.stdout + rehearsed.stderr);
      if (blocked) {
        assert.match(rehearsed.stdout, /covered by.*consent-banner/i);
      } else {
        const recorded = await invoke(project, ["record"]);
        assert.equal(recorded.ok, true, recorded.stdout + recorded.stderr);
        if (variant === "reviews") {
          const rerendered = await invoke(project, ["render", "--overwrite"]);
          assert.equal(rerendered.ok, true, rerendered.stdout + rerendered.stderr);
        }
      }
      const response = join(project, "smoke-response.md");
      await writeFile(
        response,
        blocked
          ? "Start trial is covered by the consent banner. I left it in place and did not make a video.\n"
          : "Scripted capture, not an agent response.\n",
      );
      const result = await finish(project, response, "completed");
      assert.equal(
        result.status,
        variant === "wrong-video" ? "fail" : "review-pending",
        JSON.stringify(result),
      );
      if (variant === "reviews") {
        const [first, second] = result.candidates;
        assert.equal(result.candidates.length, 2);
        assert.ok(first?.captureId && second?.captureId);
        assert.equal(first.captureId, second.captureId);
        assert.deepEqual(first.problems, []);
        assert.deepEqual(second.problems, []);
      }
      if (variant === "wrong-video") {
        assert.deepEqual(result.candidates[0]?.problems, [
          "No fixture evidence that Owners' reviews reached the viewport during this capture",
        ]);
      }
      console.log(`  ${result.status} (expected)`);
    } finally {
      await run.close();
    }
  }
}
