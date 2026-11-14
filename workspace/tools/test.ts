/**
 * `test`: one of the factory's two tools of its own, for nail and hammer, with `remove` (remove.ts). Every other tool
 * is que-pasa's (Deep Agents' ls, read_file, write_file, edit_file, glob, grep, execute), working in the `Sandbox` the
 * runner provides each run: the attempt's box, with its worktree at /work (factory/runs/runner.ts).
 *
 * `test` runs its cl's tests as its step's check does, through runTests, on /work, the cl's worktree with the change
 * the agent made in it.
 */

import { defineTool, type Runtime } from "@mku1tra/que-pasa/define";
import { commandAnswer } from "@mku1tra/que-pasa/sandbox";
import { z } from "zod";
import { type Context, current } from "../../factory/runs/runs.ts";
import { runTests } from "../../factory/runs/tests.ts";

export const test = defineTool({
  name: "test",
  description:
    "Runs this cl's tests: its test command, which the plan set, on /work, with your change in it. Returns the tail of its output and its exit code.",
  schema: z.object({}),
  // Not replay-safe: a test run may write.
  run: async (_input, runtime: Runtime<Context>) => {
    const t = await runTests(current(runtime.context));
    // answered as execute answers
    return commandAnswer({ output: t.out, exitCode: t.code, truncated: false });
  },
});
