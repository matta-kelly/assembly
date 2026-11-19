/**
 * The hammer step: red to green. da-hammer writes the least code that makes da-nail's tests pass, and never changes a
 * test. The check confirms no test file da-nail wrote differs from the cl's branch, then runs each of da-nail's tests
 * alone and, when every one passes, the repo's full suite once: its format, lint and every other test. It passes only
 * when both do, by their exit codes (green.sh in loke's v1 gates). A review that sends
 * the cl back to its code brings it here again, and da-hammer reads the findings in its messages.
 */

import { z } from "zod";
import { notesOf } from "../repos/notes.ts";
import type { Ledger } from "../line/ledger.ts";
import { nailed, testFilesOf, testsOf } from "./nail.ts";
import { type Message, say, type Step, type Worktree } from "../line/step.ts";
import type { Listed } from "../runs/listed.ts";

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

/** Green: each of da-nail's tests passes, run alone, and then the repo's full suite does. */
export async function green(at: Worktree, tests: Listed[]): Promise<Message> {
  const red = (await at.listed(tests)).filter((x) => !x.listed || x.code !== 0);
  if (red.length)
    return say(
      "retry",
      `red: ${red.map((x) => `${x.test.name} (${x.test.file})`).join(", ")}: ${red[0]?.out.slice(-400)}`,
      "check_failed",
    );
  const { code, out } = await at.test();
  if (code === 0) return say("pass", "green");
  return say(
    "retry",
    `the full suite is red: exit ${code}: ${out.slice(-400)}`,
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
  async check(r, d, at, ledger) {
    // The tests: every file da-nail listed, the kept ones' too.
    const files = testFilesOf(ledger, r.name);
    if (!files.length)
      return say("retry", "da-nail wrote no test file", "contract_invalid");
    const touched = await at.changed(files);
    if (touched.length)
      return say(
        "retry",
        `a test was changed: ${touched.join(", ")}`,
        "scope_exceeds_change",
      );
    const m = await green(at, nailed(ledger, r.name));
    return m.word === "pass" && d.notes ? { ...m, notes: d.notes } : m;
  },
};
