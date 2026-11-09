/**
 * A step: one transition of an item, such as a cl from ready to red, or an issue from open to planned. It names the agent that does the work, the shape of the result
 * the agent hands back, the cl section it fills, and the check that reads the result and the worktree and picks the
 * word. The orchestrator runs every step the same way and knows nothing about any one of them. A check never touches
 * the worktree itself: it asks the one it is given (Worktree), and the loop answers from the effects. Its own notes it
 * reads and writes through effects/notes.ts.
 */

import { z } from "zod";
import type { Ledger } from "../orchestrator/ledger.ts";
import type { State, Word } from "./table.ts";

/**
 * Why an attempt failed, from a fixed list, so failures can be counted by cause: the master plan's reason list. A
 * reviewer's send-back has none: its word says it.
 * - contract_invalid: the item does not hold its contract (a plan that does not lint, a cl with no test file)
 * - invalid_output: the agent's result is not a valid result (the wrong shape, no submit, a decision its findings deny)
 * - check_failed: the result is valid, and the check run on the worktree fails it (not red, not green)
 * - scope_exceeds_change: the agent changed what its step may not (a test, in the hammer step)
 * - plan_gap: a cl raised: the plan did not give it what it needs
 * - missing_context: the planner raised: the issue does not hold what a plan needs
 * - budget_exceeded: the run went past its time limit
 * - missing_dependency: the attempt's setup could not install the repo's dependencies (an image older than the
 *   lockfile), so no agent ran
 * The other causes on the list name parts not built yet: untestable_as_specified, flaky_check,
 * restack_conflict, escape.
 */
export const causes = [
  "contract_invalid",
  "untestable_as_specified",
  "missing_dependency",
  "scope_exceeds_change",
  "plan_gap",
  "missing_context",
  "invalid_output",
  "check_failed",
  "flaky_check",
  "restack_conflict",
  "budget_exceeded",
  "escape",
] as const;
export type Cause = (typeof causes)[number];

/**
 * One run of a test command by a check, in a container of its own. Its inputs are the worktree's tree, the command and
 * the image: the same inputs give the same answer, so `input` is what a reuse would look up.
 */
export interface CheckRun {
  command: string;
  image: string;
  tree: string; // the worktree's tree hash, what was uncommitted included
  input: string; // sha256 of the tree, the command and the image
  code: number;
  at: number; // when it started, ms since the epoch
  ms: number;
}

/** A test run's exit code and output, and the run as the ledger records it. */
export interface TestRun {
  code: number;
  out: string;
  check: CheckRun;
}

/**
 * What a check may ask of the attempt's worktree. The loop gives one per attempt, and records the test run it made.
 * - test: runs the item's test command, once: asked again, it gives back the same run
 * - changed: which of `files` differ from the item's branch, committed or not
 * - exists: which of `files` are in the worktree
 * - touched: every file that differs from where the attempt started, new and removed ones too
 */
export interface Worktree {
  test(): Promise<TestRun>;
  changed(files: string[]): Promise<string[]>;
  touched(): Promise<string[]>;
  exists(files: string[]): string[];
}

/** A check's word, and why: the reason in words, and a failure's cause from the list. */
export interface Verdict {
  word: Word;
  reason: string;
  cause?: Cause;
}

/** The raise shape, the same for every step: the agent could not do its job from the cl ([[cl#Raise]]). */
export const raise = z.object({
  word: z.literal("raise"),
  from: z.string().describe("which agent, and in which step"),
  missing: z
    .string()
    .describe("what the cl does not hold, or what does not hold in it"),
  evidence: z.string().describe("the failing test, or the file and line"),
});
export type Raise = z.infer<typeof raise>;

/** One attempt of one step on one item, and where its files are on the host. Plain JSON: it is a run's context. */
export type Run = {
  name: string; // the item's name: the issue's, or the cl's
  kind: "issue" | "cl";
  issue: string; // the issue it is, or belongs to
  seq: number; // a cl's place in its plan's order
  n: number; // the attempt, from 1, never reused
  path: string; // the item's note, which the orchestrator writes
  repo: string; // the repo the item changes
  image: string; // the repo's image: the sandbox and the checks run in it
  test: string; // a cl: the command that runs its test files. An issue: the repo's full suite
  setup: string; // the command that installs the repo's dependencies into a new worktree, offline. '' for none
  dir: string; // the attempt's folder: runs/<issue>/issue/<n>/, or runs/<issue>/cl/<cut>/<n>/
  work: string; // the worktree, mounted at /work in the attempt's sandbox
};

/**
 * What a bound step's agent can reach in the worktree: its cut's files, from the repo's root. It reads `read` and
 * `change`, and writes `change`; to it, nothing else in the worktree exists. Plain JSON: it is part of a run's context.
 */
export type View = { read: string[]; change: string[] };

export interface Step<D extends { word: "done" }> {
  from: State;
  agent: string; // the agent's name, in agents/
  worktree?: "ro"; // the agent may read the worktree but not edit it, as a review
  done: z.ZodType<D>; // the done shape. The result is this or the raise shape
  section: string; // the note's section the orchestrator writes from a done result, and the step's name in a commit
  render(d: D): string; // that section's text
  check(run: Run, d: D, at: Worktree): Promise<Verdict>;
  /** What the agent reads: the item's note when left out. A review reads more, as the issue with its plan. */
  input?(run: Run, ledger: Ledger): string;
  /** What a done result writes, once its check passes or sends it back: its section of the item's note when left out. */
  write?(run: Run, d: D, v: Verdict): void;
  /**
   * What its agent can reach: its cut's files. Left out, the agent sees the whole worktree, as a step that explores
   * does (the planner) or judges (the reviews).
   */
  view?(run: Run, ledger: Ledger): View;
  /** The runs this step judges, as the item and the step each passed: its trace links to them. A review has them. */
  judges?(run: Run, ledger: Ledger): { name: string; step: State }[];
}

/** The result a step's agent may hand back: its done shape or the raise shape, told apart by `word`. The agent's
 * output wraps it, as `{ result }`, since an output is an object. */
export function resultOf<D extends { word: "done" }>(step: Step<D>) {
  return z.union([step.done, raise]);
}
