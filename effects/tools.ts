/**
 * What the runner gives the agents' tools: the run's context, the resources it resolves to, and the factory's one tool
 * of its own. Every other tool is que-pasa's (Deep Agents' ls, read_file, write_file, edit_file, glob, grep, execute),
 * working in the `Sandbox` the runner provides each run (effects/runner.ts).
 *
 * A bound step's run (nail, hammer) has a view in its context: its cut's files. Its Sandbox is que-pasa's view over
 * the attempt's box: to its tools, a path outside the view does not exist, and a write outside its change files is
 * refused. It gets no execute, since a shell reaches any path (Deep Agents: a virtual root "provides no security with
 * shell access"); `test` runs its cl's tests instead, in the box itself (`Container`). Code its tests run can still
 * write anywhere in /work, so the loop fails an attempt whose worktree changed a file outside the change files, and
 * commits only those. A run with no view (the planner, the reviews) sees the worktree.
 */

import {
  defineResource,
  defineTool,
  type Runtime,
} from "@mku1tra/que-pasa/define";
import type { Podman } from "@mku1tra/que-pasa/sandbox";
import { z } from "zod";
import type { Run, View } from "../process/step.ts";

/** What a run of the inner loop gives its tools: the attempt. JSON, so que-pasa keeps it with the run. */
export type Context = {
  run: Run;
  view?: View; // a bound step's: its cut's files. None: the whole worktree
  readOnly: boolean; // its worktree is mounted read-only, as a review's
};

/** The attempt's box itself, past any view: what `test` runs its command in. */
export const Container = defineResource<Podman>("container");

/** The most of a test run's output `test` gives back: its tail, where a failure is. */
const limit = 20_000;

export const test = defineTool({
  name: "test",
  description:
    "Runs this cl's tests: its test command, which the plan set, in the worktree. Returns the output and the exit code.",
  schema: z.object({}),
  uses: [Container],
  // Not replay-safe: a test run may write.
  run: async (_input, runtime: Runtime<Context>) => {
    const box = await runtime.use(Container);
    const r = await box.execute(runtime.context.run.test);
    const out =
      r.output.length > limit
        ? `[first ${r.output.length - limit} characters cut]\n${r.output.slice(-limit)}`
        : r.output;
    const status =
      r.exitCode === null
        ? "[Command was killed]"
        : `[Command ${r.exitCode === 0 ? "succeeded" : "failed"} with exit code ${r.exitCode}]`;
    return `${out}${out.endsWith("\n") || out === "" ? "" : "\n"}${status}`;
  },
});
