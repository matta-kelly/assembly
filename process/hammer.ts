/**
 * The hammer step: red to green. da-hammer writes the least code that makes da-nail's tests pass, and never changes a
 * test. The check confirms no test file the cl's Tests section names differs from the cl's branch, then runs the cl's
 * test command and passes only when it passes (green.sh in loke's v1 gates). A review that sends the cl back to its
 * code brings it here again, and da-hammer reads the findings in the cl's Review section.
 */

import { z } from "zod";
import { testFiles } from "./nail.ts";
import type { Step, Verdict, Worktree } from "./step.ts";

const done = z.object({
  word: z.literal("done"),
  changed: z
    .array(z.string())
    .min(1)
    .describe("each file it changed, from the repo's root"),
  notes: z
    .string()
    .optional()
    .describe("anything the review should know, for the cl's Code section"),
});
type Done = z.infer<typeof done>;

/** Green: the cl's test command passes. */
export async function green(at: Worktree): Promise<Verdict> {
  const { code, out } = await at.test();
  if (code === 0) return { word: "pass", reason: "green" };
  return {
    word: "retry",
    cause: "check_failed",
    reason: `red: exit ${code}: ${out.slice(-400)}`,
  };
}

export const hammer: Step<Done> = {
  from: "red",
  agent: "da-hammer",
  done,
  section: "Code",
  render: (d) =>
    [
      ...d.changed.map((f) => `- \`${f}\``),
      ...(d.notes ? ["", d.notes] : []),
    ].join("\n"),
  async check(r, _d, at) {
    const tests = testFiles(r.path);
    if (!tests.length)
      return {
        word: "retry",
        cause: "contract_invalid",
        reason: "the cl's Tests section names no test file",
      };
    const touched = await at.changed(tests);
    if (touched.length)
      return {
        word: "retry",
        cause: "scope_exceeds_change",
        reason: `a test was changed: ${touched.join(", ")}`,
      };
    return green(at);
  },
};
