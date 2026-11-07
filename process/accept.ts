/**
 * The accept step: an issue from built to accepted, or back to the planner. The final check, in two parts: code runs
 * the repo's full suite on the issue's branch, which every cl was merged into; then issue-review, read-only, judges the
 * result against the issue's intent and Check. An accepted issue's branch waits for Matt to land it.
 */

import { z } from "zod";
import { read, writeSection } from "../effects/notes.ts";
import { planPath } from "./plan.ts";
import type { Step } from "./step.ts";

const done = z.object({
  word: z.literal("done"),
  decision: z
    .enum(["accept", "plan"])
    .describe("accept, or send the issue back to the planner"),
  findings: z
    .array(
      z.object({
        what: z
          .string()
          .min(1)
          .describe("what is not met, and what done looks like"),
        where: z
          .string()
          .min(1)
          .describe("the issue's Check item, the cl, or the file and line"),
      }),
    )
    .describe("none for accept, at least one for a send-back"),
  notes: z.string().optional(),
});
type Done = z.infer<typeof done>;

const render = (d: Done) =>
  [
    `- decision: ${d.decision}`,
    ...d.findings.map((f) => `- finding: ${f.what} (${f.where})`),
    ...(d.notes ? ["", d.notes] : []),
  ].join("\n");

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
  section: "Acceptance",
  render,
  input(r, ledger) {
    const cls = ledger.cls(r.name).filter((c) => c.state === "merged");
    return [
      read(r.path),
      "",
      "# The plan",
      read(planPath(r.path, r.name)),
      "",
      "# Its cls, each merged into the issue's branch",
      ...cls.map((c) => read(c.path)),
    ].join("\n");
  },
  write(r, d) {
    writeSection(r.path, "Acceptance", render(d));
  },
  async check(_r, d, at) {
    if (d.decision === "accept" && d.findings.length)
      return {
        word: "retry",
        cause: "invalid_output",
        reason: "an accept with findings: accept has none",
      };
    if (d.decision === "plan" && !d.findings.length)
      return {
        word: "retry",
        cause: "invalid_output",
        reason: "a send-back with no findings",
      };
    const suite = await at.test();
    if (suite.code !== 0)
      return {
        word: "to-plan",
        cause: "check_failed",
        reason: `the full suite is red on the issue's branch: exit ${suite.code}: ${suite.out.slice(-400)}`,
      };
    return d.decision === "accept"
      ? {
          word: "pass",
          reason: "accepted: the full suite is green, and the issue is met",
        }
      : {
          word: "to-plan",
          reason: "back to the planner",
        };
  },
};
