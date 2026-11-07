/**
 * The review step: green to approved, or back. cl-review reads the cl and the worktree, read-only, and decides:
 * approve, or send the cl back to its tests or to its code, with findings. The check confirms the decision and its
 * findings agree, and that the tests are still green. A send-back puts the findings in the cl's Review section, where
 * da-nail or da-hammer reads them.
 */

import { z } from "zod";
import { green } from "./hammer.ts";
import type { Step } from "./step.ts";

const done = z.object({
  word: z.literal("done"),
  decision: z
    .enum(["approve", "tests", "code"])
    .describe(
      "approve, or send the cl back to its tests (da-nail) or to its code (da-hammer)",
    ),
  findings: z
    .array(
      z.object({
        what: z.string().describe("what is wrong, and what done looks like"),
        where: z.string().describe("the file and line, or the behavior"),
      }),
    )
    .describe("none for approve, at least one for a send-back"),
  notes: z.string().optional(),
});
type Done = z.infer<typeof done>;

const words = { approve: "pass", tests: "to-tests", code: "to-code" } as const;

export const review: Step<Done> = {
  from: "green",
  agent: "cl-review",
  worktree: "ro",
  // the tests and the code it reviews
  judges: (r) => [
    { name: r.name, step: "ready" },
    { name: r.name, step: "red" },
  ],
  done,
  section: "Review",
  render: (d) =>
    [
      `- decision: ${d.decision}`,
      ...d.findings.map((f) => `- finding: ${f.what} (${f.where})`),
      ...(d.notes ? ["", d.notes] : []),
    ].join("\n"),
  async check(r, d) {
    if (d.decision === "approve" && d.findings.length)
      return {
        word: "retry",
        cause: "invalid_output",
        reason: "an approve with findings: approve has none",
      };
    if (d.decision !== "approve" && !d.findings.length)
      return {
        word: "retry",
        cause: "invalid_output",
        reason: `a send-back to ${d.decision} with no findings`,
      };
    const g = await green(r);
    if (g.word !== "pass")
      return {
        word: "retry",
        cause: "check_failed",
        reason: `not green at review: ${g.reason}`,
        ...(g.ran ? { ran: g.ran } : {}),
      };
    return {
      word: words[d.decision],
      reason: d.decision === "approve" ? "approved" : `back to ${d.decision}`,
      ...(g.ran ? { ran: g.ran } : {}),
    };
  },
};
