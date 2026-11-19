/**
 * The hammer step: red to green. da-hammer writes the least code that makes da-nail's tests pass, and never changes a
 * test. The check confirms no test file da-nail wrote differs from the cl's branch, then runs the repo's own check, its
 * full suite, in the attempt's workspace: its format, lint and every test, da-nail's among them. It passes only when
 * that passes, by its exit code alone (green.sh in loke's v1 gates). A review that sends the cl back to its code
 * brings it here again, and da-hammer reads the findings in its messages.
 */

import { z } from "zod";
import { notesOf } from "../repos/notes.ts";
import type { Ledger } from "../line/ledger.ts";
import { testsOf } from "./nail.ts";
import { declared, untouched } from "../line/gate.ts";
import { type Message, say, type Step, type Worktree } from "../line/step.ts";

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

/** Green: the repo's own check passes, by its exit code. */
export async function green(at: Worktree): Promise<Message> {
  const { code, out } = await at.test();
  if (code === 0) return say("pass", "green");
  return say(
    "retry",
    `red: the check fails: exit ${code}: ${out.slice(-400)}`,
    "check_failed",
  );
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
  done,
  about: ["tests", "cl", "plan", "issue"],
  input: (r, ledger) =>
    [notesOf(r).text(r.note), "", testsOf(ledger, r.name)].join("\n"),
  // no test of da-nail's changed, and the change is exactly the files listed
  gate: async (r, d, view) => [
    ...(await untouched(r.tests)(view)),
    ...(await declared(d.changed)(view)),
  ],
  async check(r, d, at) {
    if (!r.tests.length)
      return say("retry", "da-nail wrote no test file", "contract_invalid");
    const m = await green(at);
    return m.word === "pass" && d.notes ? { ...m, notes: d.notes } : m;
  },
};
