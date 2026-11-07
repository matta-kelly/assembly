/**
 * The plan review step: an issue from planned to building, or back to the planner. plan-review, an agent that did not
 * write the plan, reads the issue, the plan and the code, read-only, and judges whether the cuts, built as written,
 * meet the issue's Check. Its findings go into the issue's note, where the planner reads them. On approve, the
 * orchestrator writes the plan note and a cl note per cut, and the cls start (orchestrator/advance.ts).
 */

import { z } from "zod";
import { read, writeSection } from "../effects/notes.ts";
import { type Plan, planText } from "./plan.ts";
import type { Step } from "./step.ts";

const done = z.object({
  word: z.literal("done"),
  decision: z
    .enum(["approve", "plan"])
    .describe("approve, or send it back to the planner"),
  findings: z
    .array(
      z.object({
        what: z
          .string()
          .min(1)
          .describe("what is wrong, and what done looks like"),
        where: z
          .string()
          .min(1)
          .describe("the cut, the seam, or the issue's Check item"),
      }),
    )
    .describe("none for approve, at least one for a send-back"),
  notes: z.string().optional(),
});
type Done = z.infer<typeof done>;

const render = (d: Done) =>
  [
    `- decision: ${d.decision}`,
    ...d.findings.map((f) => `- finding: ${f.what} (${f.where})`),
    ...(d.notes ? ["", d.notes] : []),
  ].join("\n");

export const planReview: Step<Done> = {
  from: "planned",
  agent: "plan-review",
  worktree: "ro",
  // the plan it reviews
  judges: (r) => [{ name: r.name, step: "open" }],
  done,
  section: "Plan review",
  render,
  input(r, ledger) {
    const p = ledger.passed(r.name, "open") as Plan | undefined;
    if (!p) throw new Error(`issue ${r.name} has no plan to review`);
    return [read(r.path), "", "# The plan to review", planText(p)].join("\n");
  },
  write(r, d) {
    writeSection(r.path, "Plan review", render(d));
  },
  async check(_r, d) {
    if (d.decision === "approve" && d.findings.length)
      return {
        word: "retry",
        cause: "invalid_output",
        reason: "an approve with findings: approve has none",
      };
    if (d.decision === "plan" && !d.findings.length)
      return {
        word: "retry",
        cause: "invalid_output",
        reason: "a send-back with no findings",
      };
    return d.decision === "approve"
      ? { word: "pass", reason: "the plan is approved" }
      : { word: "to-plan", reason: "back to the planner" };
  },
};
