/**
 * The hammer step: red to green. da-hammer writes the least code that makes da-nail's tests pass, and never changes a
 * test. The check confirms no test file da-nail wrote, or the cl's test command runs, differs from the cl's branch,
 * then runs the cl's test command and passes only when it passes (green.sh in loke's v1 gates). A review that sends
 * the cl back to its code brings it here again, and da-hammer reads the findings in its messages.
 */

import { z } from "zod";
import { read } from "../effects/notes.ts";
import type { Ledger } from "../orchestrator/ledger.ts";
import { testFilesOf, testsOf } from "./nail.ts";
import { pathsIn } from "./plan.ts";
import { type Message, say, type Step, type Worktree } from "./step.ts";

const done = z.object({
  word: z.literal("done"),
  changed: z
    .array(z.string())
    .min(1)
    .describe("each file it changed, from the repo's root"),
  notes: z
    .string()
    .optional()
    .describe("a choice the review should know, and why"),
});
type Done = z.infer<typeof done>;

/** Green: the cl's test command passes. */
export async function green(at: Worktree): Promise<Message> {
  const { code, out } = await at.test();
  if (code === 0) return say("pass", "green");
  return say("retry", `red: exit ${code}: ${out.slice(-400)}`, "check_failed");
}

/** The files da-hammer changed for the cl, as the review reads them. */
export const changedOf = (ledger: Ledger, cl: string): string =>
  [
    "# da-hammer's files",
    ...((ledger.passed(cl, "red") as Done | undefined)?.changed ?? []).map(
      (f) => `- \`${f}\``,
    ),
  ].join("\n");

export const hammer: Step<Done> = {
  from: "red",
  agent: "da-hammer",
  // a sparse checkout of its cl's checkout
  bound: true,
  done,
  about: ["tests", "cl", "plan", "issue"],
  input: (r, ledger) => [read(r.path), "", testsOf(ledger, r.name)].join("\n"),
  async check(r, d, at, ledger) {
    // The tests: da-nail's, and every test file the cl's test command runs, the existing ones too.
    const nailed = testFilesOf(ledger, r.name);
    if (!nailed.length)
      return say("retry", "da-nail wrote no test file", "contract_invalid");
    const touched = await at.changed([
      ...new Set([...nailed, ...pathsIn(r.test)]),
    ]);
    if (touched.length)
      return say(
        "retry",
        `a test was changed: ${touched.join(", ")}`,
        "scope_exceeds_change",
      );
    const m = await green(at);
    return m.word === "pass" && d.notes ? { ...m, notes: d.notes } : m;
  },
};
