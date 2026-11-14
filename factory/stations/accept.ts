/**
 * The accept step: an issue from built to accepted, or back to the planner. The final check, in two parts: code runs
 * each repo's full suite on main, where every cl has landed; then issue-review, read-only, judges the result against the
 * issue's intent and Done. It closes the issue and never gates the code: the code is on main already.
 */

import { z } from "zod";
import { notesOf } from "../repos/notes.ts";
import { planPath } from "./plan.ts";
import type { Step } from "../line/step.ts";

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
  // the plan, and each landed cl's tests, code and review
  judges: (r, ledger) => [
    { name: r.name, step: "open" },
    ...ledger
      .cls(r.name)
      .filter((c) => c.state === "landed")
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
    const notes = notesOf(r);
    const plan = notes.text(planPath(r.note, r.name));
    const cls = ledger.cls(r.name).filter((c) => c.state === "landed");
    // the lone cl of an issue that takes one has no plan note: its cl is its plan
    return [
      notes.text(r.note),
      "",
      ...(plan ? ["# The plan", plan, ""] : []),
      "# Its cls, each landed on main",
      ...cls.map((c) => notes.text(c.note)),
    ].join("\n");
  },
  async check(r, d, at) {
    const suite = await at.test();
    if (suite.code !== 0)
      return {
        word: "back",
        cause: "check_failed",
        reason: "the full suite is red on main",
        findings: [
          {
            about: "plan",
            what: `the full suite is red: exit ${suite.code}: ${suite.out.slice(-400)}`,
            where: r.repos?.length
              ? r.repos.map((p) => `${p.name}: ${p.test}`).join("; ")
              : r.test,
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
