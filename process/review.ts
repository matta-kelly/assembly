/**
 * The review step: green to approved, or back. cl-review reads the cl, da-nail's tests, da-hammer's files and the
 * worktree, read-only, and approves, or hands back findings: about the tests (to da-nail), the code (to da-hammer), or
 * the cl, its plan or its issue (raised). The check confirms the tests are still green.
 */

import { z } from "zod";
import { changedOf, green } from "./hammer.ts";
import { testsOf } from "./nail.ts";
import { notesOf } from "../effects/notes.ts";
import type { Step } from "./step.ts";

const done = z.object({
  word: z.literal("done"),
  notes: z.string().optional(),
});
type Done = z.infer<typeof done>;

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
  about: ["tests", "code", "cl", "plan", "issue"],
  input: (r, ledger) =>
    [
      notesOf(r).text(r.note),
      "",
      testsOf(ledger, r.name),
      "",
      changedOf(ledger, r.name),
    ].join("\n"),
  async check(_r, d, at) {
    const g = await green(at);
    if (g.word !== "pass")
      return { ...g, reason: `not green at review: ${g.reason}` };
    return {
      word: "pass",
      reason: "approved",
      findings: [],
      ...(d.notes ? { notes: d.notes } : {}),
    };
  },
};
