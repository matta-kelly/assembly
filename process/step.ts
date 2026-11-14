/**
 * A step: one transition of an item, such as a cl from ready to red, or an issue from open to planned. It names the
 * agent that does the work, the shape of the result the agent hands back, what the agent may send back about, and the
 * check that reads the result and the worktree and gives the message. The orchestrator runs every step the same way
 * and knows nothing about any one of them. A check never touches the worktree itself: it asks the one it is given
 * (Worktree), and the loop answers from the effects. It reads notes through effects/notes.ts, and writes none.
 */

import { z } from "zod";
import type { Ledger } from "../orchestrator/ledger.ts";
import type { Artifact, State, Word } from "./table.ts";

/**
 * Why an attempt failed, from a fixed list, so failures can be counted by cause: the master plan's reason list. A
 * back is not a failure, and has none unless a check made it (a red suite at acceptance).
 * - contract_invalid: the item does not hold its contract (a plan that does not lint, a cl with no test file)
 * - invalid_output: the agent's result is not a valid result (the wrong shape, no submit)
 * - check_failed: the result is valid, and the check run on the worktree fails it (not red, not green)
 * - scope_exceeds_change: the agent changed what its step may not (a test, in the hammer step)
 * - budget_exceeded: the run went past its time limit
 * - missing_dependency: the attempt's setup could not install the repo's dependencies (an image older than the
 *   lockfile), so no agent ran
 * - restack_conflict: a land's rebase onto main conflicts
 * The other causes on the list name parts not built yet: untestable_as_specified, flaky_check, escape.
 */
export const causes = [
  "contract_invalid",
  "untestable_as_specified",
  "missing_dependency",
  "scope_exceeds_change",
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
 * - touched: every file that differs from where the attempt started, the item's branch, new and removed ones too
 */
export interface Worktree {
  test(): Promise<TestRun>;
  changed(files: string[]): Promise<string[]>;
  touched(): Promise<string[]>;
  exists(files: string[]): string[];
}

/** A fault in one artifact: what fails, with its evidence, and where (the file and line, the promise, the Done item). */
export const finding = z.object({
  about: z.enum(["issue", "plan", "cl", "tests", "code"]),
  what: z.string().min(1).describe("what fails, and the evidence"),
  where: z
    .string()
    .min(1)
    .describe("the file and line, the promise, or the Done item"),
});
export type Finding = { about: Artifact; what: string; where: string };

/**
 * The record a step ends with: its word, why in one line, a failure's cause, its findings, and the agent's notes for
 * the next step. Who it is from is the attempt it ends. The ledger keeps it as the item's event, and the next agent
 * reads it in its input.
 */
export interface Message {
  word: Word;
  reason: string;
  cause?: Cause;
  findings: Finding[];
  notes?: string;
  met?: boolean; // a pass whose tests already pass: the code meets them, so the table takes it past the code (table.ts)
}

/** The back shape: what an agent hands back in place of its done result, findings about the artifacts it may name. */
export function back(about: Artifact[]) {
  return z.object({
    word: z.literal("back"),
    findings: z
      .array(
        finding.extend({ about: z.enum(about as [Artifact, ...Artifact[]]) }),
      )
      .min(1),
  });
}
export type Back = { word: "back"; findings: Finding[] };

/**
 * A repo an issue may change, with what its attempts need, read from its worktree at each attempt (effects/repo.ts):
 * the image its sandbox and checks run in, its full suite, and the setup that installs its dependencies into the
 * worktree ('' for none). Its name is its folder's, as a cl names it.
 */
export type Repo = {
  name: string;
  repo: string;
  image: string;
  test: string;
  setup: string;
};

/**
 * An item's worktree, where an attempt works, before the attempt reads its settings: the item, the attempt's folder,
 * and, for an issue of several repos, each repo, its worktree at work/<name>.
 */
export type Tree = {
  name: string; // the item's name: the issue's, or the cl's
  kind: "issue" | "cl";
  issue: string; // the issue it is, or belongs to
  n: number; // the attempt, from 1, never reused
  repo: string; // the repo the item changes: an issue's first, when it has several
  dir: string; // the attempt's folder: runs/<issue>/issue/<n>/, or runs/<issue>/cl/<cut>/<n>/
  work: string; // the item's one worktree, beside its attempts' folders, mounted at /work in the attempt's sandbox
  repos?: { name: string; repo: string }[];
};

/** The notes an attempt reads: the notes repo, at the commit of its main the attempt started from. */
export type NotesAt = { repo: string; commit: string };

/**
 * One attempt of one step on one item: its worktree, its note, the notes' commit it reads, and the settings read at
 * its start. Plain JSON: it is a run's context.
 */
export type Run = Omit<Tree, "repos"> & {
  seq: number; // a cl's place in its plan's order
  note: string; // the item's note, from the notes repo's root: _well/<name>.md
  notes: NotesAt;
  image: string; // the repo's image: the sandbox and the checks run in it
  test: string; // a cl: the command that runs its test files, from its note. An issue: the repo's full suite
  setup: string; // the command that installs the repo's dependencies into the worktree, offline. '' for none
  // An issue's repos when it has more than one: its own steps see each at work/<name>, and its suite runs in each. Its
  // repo, test and setup are then the first's, and its image the one its own steps' sandbox runs.
  repos?: Repo[];
};

export interface Step<D extends { word: "done" }> {
  from: State;
  agent: string; // the agent's name, in workspace/agents/
  worktree?: "ro"; // the agent may read the worktree but not edit it, as a review
  done: z.ZodType<D>; // the done shape. The result is this or the back shape
  about: Artifact[]; // what its agent may send back about
  check(run: Run, d: D, at: Worktree, ledger: Ledger): Promise<Message>;
  /**
   * What the agent reads, before its messages: the item's note when left out. A review reads more, as the issue with
   * its plan.
   */
  input?(run: Run, ledger: Ledger): string;
  /** The runs this step judges, as the item and the step each passed: its trace links to them. A review has them. */
  judges?(run: Run, ledger: Ledger): { name: string; step: State }[];
}

/** The result a step's agent may hand back: its done shape or the back shape, told apart by `word`. The agent's
 * output wraps it, as `{ result }`, since an output is an object. */
export function resultOf<D extends { word: "done" }>(step: Step<D>) {
  return z.union([step.done, back(step.about)]);
}

/** A message with no findings. */
export const say = (word: Word, reason: string, cause?: Cause): Message =>
  cause
    ? { word, reason, cause, findings: [] }
    : { word, reason, findings: [] };
