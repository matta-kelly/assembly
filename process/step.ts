/**
 * A step: one transition of a cl, such as ready to red. It names the agent that does the work, the shape of the result
 * the agent hands back, the cl section it fills, and the check that reads the result and the worktree and picks the
 * word. The orchestrator runs every step the same way and knows nothing about any one of them. A check runs no
 * command itself: git and podman go through orchestrator/start.ts.
 */

import { z } from "zod";
import type { State, Word } from "../orchestrator/table.ts";

/** A check's word, and why. The reason goes into the ledger's event. */
export interface Verdict {
  word: Word;
  reason: string;
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

/** One attempt of one step on one cl, and where its files are on the host. */
export interface Run {
  cl: string; // the cl's name
  n: number; // the attempt, from 1, never reused
  path: string; // the cl note, which the orchestrator writes
  repo: string; // the repo the cl changes
  image: string; // the repo's image: the agent and the checks run in it
  test: string; // the command that runs the cl's test files, in the worktree
  dir: string; // runs/<cl>/<n>/
  work: string; // the worktree, mounted at /work
  packet: string; // the cl copy and the result's JSON Schema, mounted read-only at /packet
  out: string; // where the agent writes result.json, mounted at /out
}

export interface Step<D extends { word: "done" }> {
  from: State;
  agent: string; // the agent's name, in agents/
  worktree?: "ro"; // the agent may read the worktree but not edit it, as a review
  done: z.ZodType<D>; // the done shape. The result is this or the raise shape
  section: string; // the cl section the orchestrator writes from a done result
  render(d: D): string; // that section's text
  check(run: Run, d: D): Promise<Verdict>;
}

/** The result a step's agent may hand back: its done shape or the raise shape, told apart by `word`. */
export function resultOf<D extends { word: "done" }>(step: Step<D>) {
  return z.union([step.done, raise]);
}
