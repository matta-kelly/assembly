/**
 * The nail step: ready to red. da-nail writes the tests of the cl's Promises, each listed as `new` (the change makes it
 * pass) or `kept` (it passes before the change and after). The check runs each listed test alone and reads its exit
 * code only (factory/runs/listed.ts); its output is never parsed. A test that does not build, or is not found, goes
 * back to da-nail. Then the cl's kind (its note's `shape.change`) decides where it goes:
 * - a behavior cl: each kept test passes; a new test that fails means there is code to write: to da-hammer. Every new
 *   test passing goes to the review, the code meets them (met). One rule on every pass: a cl comes back here (from
 *   da-hammer, a review, or the operator) with its code in the worktree, and its tests may pass at once
 * - a structure cl: its tests pin what the code does now (characterization tests, Feathers), so each passes, and the cl
 *   goes to da-hammer for the refactor. A test that fails pins nothing true: back to da-nail
 * A red from a stub counts: the stub fixes the interface. A test that checks nothing is the review's to find.
 */

import { z } from "zod";
import { notesOf } from "../repos/notes.ts";
import type { Ledger } from "../line/ledger.ts";
import { type Message, say, type Step } from "../line/step.ts";
import {
  type Listed,
  type Result,
  runnable,
  unrunnable,
} from "../runs/listed.ts";
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
        file: z
          .string()
          .describe(`the test file, from the repo's root: ${runnable}`),
        name: z
          .string()
          .describe(
            "the test's own name: a Go test's top-level name, a vitest test's name; a shell test is its file",
          ),
        kind: z
          .enum(["new", "kept"])
          .describe(
            "new: the cl's change makes it pass, so it fails now. kept: it passes now and must still pass after",
          ),
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
    ...nailed(ledger, cl).map((t) => `- \`${t.file}\`, ${t.name} (${t.kind})`),
  ].join("\n");

/** The tests of `results`, each with its file, for a reason. */
const named = (results: Result[]) =>
  results.map((x) => `${x.test.name} (${x.test.file})`).join(", ");

/** The output of the first of `results`, its tail, for a reason. */
const tailOf = (results: Result[]) => results[0]?.out.slice(-400) ?? "";

/**
 * Where the runs of listed tests send the cl, by their exit codes alone. A test that did not build or was not found
 * goes back to da-nail. A behavior cl: a kept test that fails back to da-nail; a new test that fails to its code; all
 * passing to its review (met). A structure cl: all passing to its code, for the refactor; any failing back to da-nail.
 */
export function judge(results: Result[], change: Change): Message {
  const unbuilt = results.filter((x) => !x.listed);
  if (unbuilt.length)
    return say(
      "retry",
      `tests that do not build or are not found: ${named(unbuilt)}: ${tailOf(unbuilt)}`,
      "check_failed",
    );
  const red = results.filter((x) => x.code !== 0);
  if (change === "structure")
    return red.length
      ? say(
          "retry",
          `red: a structure cl's tests pin the code as it is, so each passes now: ${named(red)}: ${tailOf(red)}`,
          "check_failed",
        )
      : say("pass", "green: the behavior is pinned, for the refactor");
  const keptRed = red.filter((x) => x.test.kind === "kept");
  if (keptRed.length)
    return say(
      "retry",
      `kept tests fail before the change: ${named(keptRed)}: ${tailOf(keptRed)}`,
      "check_failed",
    );
  if (red.length) return say("pass", `red: ${named(red)}`);
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
    const none = unrunnable(r, d.tests);
    if (none.length) return say("retry", none.join("; "), "invalid_output");
    const m = judge(await at.listed(d.tests), changeOf(note));
    return m.word === "pass" && d.notes ? { ...m, notes: d.notes } : m;
  },
};
