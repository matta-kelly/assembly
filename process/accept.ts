/**
 * The accept step: an issue from built to accepted, or back to the planner. The final check, in two parts: code runs
 * the repo's full suite on the issue's branch, which every cl was merged into; then issue-review, read-only, judges the
 * result against the issue's intent and Check. An accepted issue's branch waits for Matt to land it.
 */

import { z } from "zod";
import { read } from "../effects/notes.ts";
import { planPath, specOf } from "./plan.ts";
import type { Step } from "./step.ts";

// Accept: no findings. A finding is handed back as the back shape, and goes to the planner (the plan) or to Matt (the
// issue).
const done = z.object({
  word: z.literal("done"),
  notes: z
    .string()
    .optional()
    .describe(
      "the Done items only the running system can show, and what Matt should look at",
    ),
});
type Done = z.infer<typeof done>;

export const accept: Step<Done> = {
  from: "built",
  agent: "issue-review",
  worktree: "ro",
  // the plan, and each merged cl's tests, code and review
  judges: (r, ledger) => [
    { name: r.name, step: "open" },
    ...ledger
      .cls(r.name)
      .filter((c) => c.state === "merged")
      .flatMap((c) =>
        (["ready", "red", "green"] as const).map((step) => ({
          name: c.name,
          step,
        })),
      ),
  ],
  done,
  about: ["plan", "issue"],
  input(r, ledger) {
    const cls = ledger.cls(r.name).filter((c) => c.state === "merged");
    // the lone cl of an issue that takes one has no plan note: its cl is its plan
    return [
      read(r.path),
      "",
      ...(specOf(ledger, r.name)?.spec.plan
        ? ["# The plan", read(planPath(r.path, r.name)), ""]
        : []),
      "# Its cls, each merged into the issue's branch",
      ...cls.map((c) => read(c.path)),
    ].join("\n");
  },
  async check(r, d, at) {
    const suite = await at.test();
    if (suite.code !== 0)
      return {
        word: "back",
        cause: "check_failed",
        reason: "the full suite is red on the issue's branch",
        findings: [
          {
            about: "plan",
            what: `the full suite is red: exit ${suite.code}: ${suite.out.slice(-400)}`,
            where: r.test,
          },
        ],
      };
    return {
      word: "pass",
      reason: "accepted: the full suite is green, and the issue is met",
      findings: [],
      ...(d.notes ? { notes: d.notes } : {}),
    };
  },
};
