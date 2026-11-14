/**
 * `test`: the factory's one tool of its own, for nail and hammer. Every other tool is que-pasa's (Deep Agents' ls,
 * read_file, write_file, edit_file, glob, grep, execute), working in the `Sandbox` the runner provides each run: the
 * attempt's box, with its worktree at /work (effects/runner.ts).
 *
 * `test` runs its cl's tests as its step's check does: for da-hammer through runTests, on /work, the cl's worktree with
 * the change the agent made in it; for da-nail through runRed, its tests without the cl's code.
 */

import { defineTool, type Runtime } from "@mku1tra/que-pasa/define";
import { commandAnswer } from "@mku1tra/que-pasa/sandbox";
import { z } from "zod";
import { type Context, current } from "../../effects/runs.ts";
import { runRed, runTests } from "../../effects/tests.ts";
import { pathsIn } from "../../process/plan.ts";

export const test = defineTool({
  name: "test",
  description:
    "Runs this cl's tests: its test command, which the plan set, on /work, with your change in it. Returns the tail of its output and its exit code.",
  schema: z.object({}),
  // Not replay-safe: a test run may write.
  run: async (_input, runtime: Runtime<Context>) => {
    const r = current(runtime.context);
    // da-nail's run is its check's: its tests without the cl's code
    const t =
      runtime.context.agent === "da-nail"
        ? await runRed(r, [
            ...new Set([...(r.tests ?? []), ...pathsIn(r.test)]),
          ])
        : await runTests(r);
    // answered as execute answers
    return commandAnswer({ output: t.out, exitCode: t.code, truncated: false });
  },
});
