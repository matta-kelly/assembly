/**
 * The plan review step: an issue from planned to building, or back to the planner. plan-review, an agent that did not
 * write the plan, reads the issue, the plan and the code, read-only, and judges whether the cuts, built as written,
 * meet the issue's Done. Its findings go back to the planner in its message. On approve, the orchestrator writes the
 * plan note and a cl note per cut, and the cls start (orchestrator/advance.ts).
 */

import { z } from "zod";
import { read } from "../effects/notes.ts";
import { specOf, specText } from "./plan.ts";
import type { Step } from "./step.ts";

// Approve: no findings. A finding is handed back as the back shape, and goes to the planner (the plan) or to Matt (the
// issue).
const done = z.object({
  word: z.literal("done"),
  notes: z.string().optional(),
});
type Done = z.infer<typeof done>;

export const planReview: Step<Done> = {
  from: "planned",
  agent: "plan-review",
  worktree: "ro",
  // the plan it reviews
  judges: (r) => [{ name: r.name, step: "open" }],
  done,
  about: ["plan", "issue"],
  input(r, ledger) {
    const s = specOf(ledger, r.name)?.spec;
    if (!s) throw new Error(`issue ${r.name} has no spec to review`);
    return [read(r.path), "", "# The spec to review", specText(s)].join("\n");
  },
  async check(_r, d) {
    return {
      word: "pass",
      reason: "the plan is approved",
      findings: [],
      ...(d.notes ? { notes: d.notes } : {}),
    };
  },
};
