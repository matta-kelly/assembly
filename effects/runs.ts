/**
 * Run folders: each item's files, under its issue, so every trial of an issue is in one place. An item's folder holds
 * its one worktree, `work`, and a folder per attempt, `<n>`, with the attempt's log (the orchestrator's own lines), its
 * trace (each tool call) and, when it did not pass, its change.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Item } from "../orchestrator/ledger.ts";
import type { Tree } from "../process/step.ts";

/** The item's folder: runs/<issue>/issue/, or runs/<issue>/cl/<cut>/. */
export const folderOf = (
  i: Pick<Item, "kind" | "name" | "issue">,
  runs: string,
) =>
  i.kind === "issue"
    ? join(runs, i.issue, "issue")
    : join(runs, i.issue, "cl", i.name.replace(`${i.issue}-`, ""));

/** The attempt's worktree, and where its files go: the item's worktree, and the attempt's own folder. */
export function runOf(i: Item, n: number, runs: string): Tree {
  const under = folderOf(i, runs);
  return {
    name: i.name,
    kind: i.kind,
    issue: i.issue,
    n,
    repo: i.repo,
    dir: join(under, String(n)),
    work: join(under, "work"),
    ...(i.repos.length
      ? { repos: i.repos.map((repo) => ({ name: basename(repo), repo })) }
      : {}),
  };
}

/**
 * The parts of an attempt, one per repo it works in: itself, or, for an issue with several repos, one per repo, with
 * that repo's settings, its worktree at work/<repo>, which its sandbox shows at /work/<repo>, and its folder under the
 * item's repos/<repo>/.
 */
export function partsOf<T extends Tree>(r: T): T[] {
  if (!r.repos?.length) return [r];
  return r.repos.map(
    ({ name, ...repo }) =>
      ({
        ...r,
        ...repo,
        repos: [],
        dir: join(dirname(r.dir), "repos", name, String(r.n)),
        work: join(r.work, name),
      }) as T,
  );
}

/** Appends a line to the attempt's log, its record of what the agent did. */
export function log(r: Pick<Tree, "dir">, line: string) {
  mkdirSync(r.dir, { recursive: true });
  appendFileSync(join(r.dir, "log"), `${line}\n`);
}
