/**
 * The nail step: ready to red. da-nail writes one test per behavior in the cl's Check, each failing at its assertion.
 * The check confirms each behavior has a test in a file that exists, then runs the cl's test command and passes only
 * when it fails at an assertion (red.sh in loke's v1 gates). A review that sends the cl back to its tests brings it
 * here again, and da-nail reads the findings in its messages.
 */

import { z } from "zod";
import { items } from "../effects/notes.ts";
import type { Ledger } from "../orchestrator/ledger.ts";
import { type Message, say, type Step } from "./step.ts";

const done = z.object({
  word: z.literal("done"),
  tests: z
    .array(
      z.object({
        behavior: z
          .number()
          .int()
          .min(1)
          .describe("the behavior's number in the cl's Check list, from 1"),
        file: z.string().describe("the test file, from the repo's root"),
        name: z.string().describe("the test's name"),
      }),
    )
    .min(1),
  notes: z
    .string()
    .optional()
    .describe(
      "anything da-hammer should know, such as the stubs and the interface they fix",
    ),
});
type Done = z.infer<typeof done>;

/** The behaviors of a cl: the top-level items of its Check list. */
export function behaviors(cl: string): string[] {
  return items(cl, "Check");
}

/** da-nail's tests for the cl: its last passed result's, none before it passed. */
const nailed = (ledger: Ledger, cl: string) =>
  (ledger.passed(cl, "ready") as Done | undefined)?.tests ?? [];

/** The test files da-nail wrote for the cl. */
export const testFilesOf = (ledger: Ledger, cl: string): string[] => [
  ...new Set(nailed(ledger, cl).map((t) => t.file)),
];

/** da-nail's tests for the cl, as the steps after it read them. */
export const testsOf = (ledger: Ledger, cl: string): string =>
  [
    "# da-nail's tests",
    ...nailed(ledger, cl).map(
      (t) => `- behavior ${t.behavior}: \`${t.file}\`, ${t.name}`,
    ),
  ].join("\n");

/** The output of a test run says it stopped before any assertion ran. */
const notLoaded =
  /^\s*SyntaxError:|Cannot find module|ERR_MODULE_NOT_FOUND|Failed to load/m;
/** The output of a test run shows an assertion failing. */
// The assertion's own error, as node:assert, chai (vitest) and jest give it: a failing test alone is not enough, since
// a test that throws before it asserts fails too.
const assertion = /AssertionError|ERR_ASSERTION|expect\(received\)/;

/** Red, from a test run's exit code and output: it failed, and at an assertion. */
export function judge(code: number, out: string): Message {
  const tail = out.slice(-400);
  if (code === 0)
    return say(
      "retry",
      `the tests pass, nothing is red: ${tail}`,
      "check_failed",
    );
  if (notLoaded.test(out))
    return say("retry", `red before any assertion: ${tail}`, "check_failed");
  if (assertion.test(out)) return say("pass", "red at an assertion");
  return say(
    "retry",
    `red, but no assertion failure is shown: ${tail}`,
    "check_failed",
  );
}

export const nail: Step<Done> = {
  from: "ready",
  agent: "da-nail",
  // a sparse checkout of its cl's checkout
  bound: true,
  done,
  about: ["cl", "plan", "issue"],
  async check(r, d, at) {
    const want = behaviors(r.path).length;
    const have = new Set(d.tests.map((t) => t.behavior));
    for (let b = 1; b <= want; b++) {
      if (!have.has(b))
        return say("retry", `behavior ${b} has no test`, "invalid_output");
    }
    const extra = [...have].filter((b) => b > want);
    if (extra.length)
      return say(
        "retry",
        `tests name behaviors the cl does not have: ${extra.join(", ")}`,
        "invalid_output",
      );
    const files = [...new Set(d.tests.map((t) => t.file))];
    const there = new Set(at.exists(files));
    const missing = files.filter((f) => !there.has(f));
    if (missing.length)
      return say(
        "retry",
        `test files not in the worktree: ${missing.join(", ")}`,
        "invalid_output",
      );
    const { code, out } = await at.test();
    const m = judge(code, out);
    return m.word === "pass" && d.notes ? { ...m, notes: d.notes } : m;
  },
};
