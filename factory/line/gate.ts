/**
 * Gates: a step's quick, exact checks of an agent's result against the worktree, each fault one the agent can fix. A
 * gate runs twice, from the same code: at the agent's submit, where que-pasa answers with each problem and the run goes
 * on (workspace/agents/submit.ts, acceptOf), and in the loop before the step's check, where a problem left is a retry
 * (factory/line/loop.ts). So the agent hears a fault while it can still fix it, and the verdict stays the factory's.
 *
 * A gate reads files only (`View`), never a test run: the check is where the suite runs. Each gate is a function of the
 * view, and a step's gate puts its own together (factory/stations/).
 */

import { normalize } from "node:path";
import type { Problem, Run, Step, View } from "./step.ts";

/** A path from the repo's root, as git gives it: no `./`, no trailing `/`. */
const pathOf = (f: string) =>
  normalize(f).replace(/^\.\//, "").replace(/\/+$/, "");

/** A list of paths, each once, as paths from the repo's root. */
const pathsOf = (files: string[]) => [...new Set(files.map(pathOf))];

/** Each of `files` is in the worktree. */
export const present =
  (files: string[]) =>
  (view: View): Promise<Problem[]> => {
    const listed = pathsOf(files);
    const there = new Set(view.exists(listed));
    return Promise.resolve(
      listed
        .filter((f) => !there.has(f))
        .map((f) => ({
          what: `${f} is listed, but it is not in the worktree`,
          cause: "invalid_output" as const,
        })),
    );
  };

/** None of `files` differs from the item's branch: another step's, which this one may not change. */
export const untouched =
  (files: string[]) =>
  async (view: View): Promise<Problem[]> =>
    files.length
      ? (await view.changed(pathsOf(files))).map((f) => ({
          what: `${f} is da-nail's test, which you may not change: put it back as it was`,
          cause: "scope_exceeds_change" as const,
        }))
      : [];

/**
 * The worktree's change is exactly `files`: a changed file the list leaves out is scratch or an omission, and a listed
 * file with no change is not part of the change. Removed files count as changed; files git ignores never do.
 */
export const declared =
  (files: string[]) =>
  async (view: View): Promise<Problem[]> => {
    const listed = new Set(pathsOf(files));
    const changed = new Set(await view.touched());
    return [
      ...[...changed]
        .filter((f) => !listed.has(f))
        .map((f) => ({
          what: `${f} is changed in the worktree but not in your list: remove it if it is scratch, or list it`,
          cause: "invalid_output" as const,
        })),
      ...[...listed]
        .filter((f) => !changed.has(f))
        .map((f) => ({
          what: `${f} is in your list but not changed: take it out of the list`,
          cause: "invalid_output" as const,
        })),
    ];
  };

/** The worktree is as the attempt began: for a step that only reads. */
export const unchanged = async (view: View): Promise<Problem[]> =>
  (await view.since()).map((f) => ({
    what: `${f} changed, and this step only reads: put it back as it was`,
    cause: "scope_exceeds_change" as const,
  }));

/**
 * The gate of a step, on any result its agent gives: a step that only reads leaves its worktree as it began, whatever
 * its word; a done result meets the step's own gate too.
 */
export function gateOf(step: Step<{ word: "done" }>) {
  return async (
    r: Run,
    result: { word: string },
    view: View,
  ): Promise<Problem[]> => [
    ...(step.worktree === "ro" ? await unchanged(view) : []),
    ...(result.word === "done" && step.gate
      ? await step.gate(r, result as never, view)
      : []),
  ];
}
