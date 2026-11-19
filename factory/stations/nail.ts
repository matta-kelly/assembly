/**
 * The nail step: ready to red. da-nail writes the tests of the cl's Promises, and lists them. The check runs the repo's
 * own check, its full suite, in the attempt's workspace (factory/runs/workspace.ts), and reads its exit code alone; its
 * output is never parsed. Each listed test file must be in the worktree. Then the cl's kind (its note's
 * `shape.change`) decides where it goes:
 * - a behavior cl: a red check means there is code to write: to da-hammer. A green one goes to the review, the code
 *   meets the tests (met). One rule on every pass: a cl comes back here (from da-hammer, a review, or the operator)
 *   with its code in the worktree, and its tests may pass at once
 * - a structure cl: its tests pin what the code does now (characterization tests, Feathers), so the check is green,
 *   and the cl goes to da-hammer for the refactor. A red one pins nothing true: back to da-nail
 * Main is green, and da-nail changes only tests, so a red is its tests. Whether it is red for the reason each test's
 * name says, and whether a test checks anything, is the review's to find.
 */

import { z } from "zod";
import { notesOf } from "../repos/notes.ts";
import type { Ledger } from "../line/ledger.ts";
import { type Message, say, type Step } from "../line/step.ts";
import { noteOf } from "./plan.ts";

/** What a cl changes, by its note's shape: what it does, or only how the code is shaped (Beck, *Tidy First?*). */
export type Change = "behavior" | "structure";

/** A cl's kind, from its note: structure only when its shape says so, else behavior, the strict rule. */
export function changeOf(note: string): Change {
  const shape = noteOf(note).fields["shape"] as
    { change?: unknown } | undefined;
  return shape?.change === "structure" ? "structure" : "behavior";
}

const done = z.object({
  word: z.literal("done"),
  tests: z
    .array(
      z.object({
        file: z.string().describe("the test file, from the repo's root"),
        name: z.string().describe("the test's own name"),
      }),
    )
    .min(1)
    .describe("each test of the cl's Promises, new or changed"),
  notes: z
    .string()
    .optional()
    .describe(
      "anything da-hammer should know, such as the stubs and the interface they fix",
    ),
});
type Done = z.infer<typeof done>;

/** A test da-nail lists: its file, from the repo's root, and its name. */
export type Listed = Done["tests"][number];

/** da-nail's tests for the cl: its last passed result's, none before it passed. */
export const nailed = (ledger: Ledger, cl: string): Listed[] =>
  (ledger.passed(cl, "ready") as Done | undefined)?.tests ?? [];

/** The test files da-nail wrote for the cl. */
export const testFilesOf = (ledger: Ledger, cl: string): string[] => [
  ...new Set(nailed(ledger, cl).map((t) => t.file)),
];

/** da-nail's tests for the cl, as the steps after it read them. */
export const testsOf = (ledger: Ledger, cl: string): string =>
  [
    "# da-nail's tests",
    ...nailed(ledger, cl).map((t) => `- \`${t.file}\`, ${t.name}`),
  ].join("\n");

/**
 * Where the repo's check sends the cl, by its exit code alone, with the tail of its output for a reason. A behavior
 * cl: red to its code; green to its review (met). A structure cl: green to its code, for the refactor; red back to
 * da-nail.
 */
export function judge(code: number, out: string, change: Change): Message {
  const tail = out.slice(-400);
  if (change === "structure")
    return code === 0
      ? say("pass", "green: the behavior is pinned, for the refactor")
      : say(
          "retry",
          `red: a structure cl's tests pin the code as it is, so the check passes now: exit ${code}: ${tail}`,
          "check_failed",
        );
  if (code !== 0) return say("pass", `red: the check fails: exit ${code}`);
  return { ...say("pass", "green: the code meets the tests"), met: true };
}

export const nail: Step<Done> = {
  from: "ready",
  agent: "da-nail",
  done,
  about: ["cl", "plan", "issue"],
  async check(r, d, at) {
    const note = notesOf(r).text(r.note);
    const files = [...new Set(d.tests.map((t) => t.file))];
    const there = new Set(at.exists(files));
    const missing = files.filter((f) => !there.has(f));
    if (missing.length)
      return say(
        "retry",
        `test files not in the worktree: ${missing.join(", ")}`,
        "invalid_output",
      );
    const ran = await at.test();
    const m = judge(ran.code, ran.out, changeOf(note));
    return m.word === "pass" && d.notes ? { ...m, notes: d.notes } : m;
  },
};
