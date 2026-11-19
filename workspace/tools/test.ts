/**
 * `test`: one of the factory's two tools of its own, for nail and hammer, with `remove` (remove.ts). Every other tool
 * is que-pasa's (Deep Agents' ls, read_file, write_file, edit_file, glob, grep, execute), working in the `Sandbox` the
 * runner provides each run: the attempt's box, with its worktree at /work (factory/runs/runner.ts).
 *
 * `test` runs the tests it is given as its step's check does, each alone by its file's runner, through runListed, on
 * /work, the cl's worktree with the change the agent made in it, and answers each one's exit code.
 */

import { defineTool, type Runtime } from "@mku1tra/que-pasa/define";
import { commandAnswer } from "@mku1tra/que-pasa/sandbox";
import { z } from "zod";
import { type Context, current } from "../../factory/runs/runs.ts";
import { runListed, runnable } from "../../factory/runs/listed.ts";

export const test = defineTool({
  name: "test",
  description: `Runs each test it is given alone, as the step's check does, on /work with your change in it, and answers each one's exit code, then the output of each that did not pass. A test file is one of ${runnable}.`,
  schema: z.object({
    tests: z
      .array(
        z.object({
          file: z.string().describe("the test file, from the repo's root"),
          name: z
            .string()
            .describe(
              "the test's own name: a Go test's top-level name, a vitest test's name; a shell test is its file",
            ),
        }),
      )
      .min(1),
  }),
  // Not replay-safe: a test run may write.
  run: async ({ tests }, runtime: Runtime<Context>) => {
    const { results } = await runListed(
      current(runtime.context),
      tests.map((t) => ({ ...t, kind: "kept" as const })),
    );
    const failed = results.filter((x) => !x.listed || x.code !== 0);
    const output = [
      ...results.map(
        (x) =>
          `${x.listed ? `exit ${x.code}` : "does not build or is not found"}: ${x.test.name} (${x.test.file})`,
      ),
      ...failed.map((x) => `\n== ${x.test.name} (${x.test.file})\n${x.out}`),
    ].join("\n");
    // answered as execute answers: 0 when every test passed
    return commandAnswer({
      output,
      exitCode: failed.length ? 1 : 0,
      truncated: false,
    });
  },
});
