/**
 * Run folders: each item's files, under its issue, so every trial of an issue is in one place. An item's folder holds
 * its one worktree, `work`, and a folder per attempt, `<n>`, with the attempt's log (the orchestrator's own lines), its
 * trace (each tool call) and, when it did not pass, its change.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Item } from "../orchestrator/ledger.ts";
import type { Run } from "../process/step.ts";

/** The item's folder: runs/<issue>/issue/, or runs/<issue>/cl/<cut>/. */
export const folderOf = (
  i: Pick<Item, "kind" | "name" | "issue">,
  runs: string,
) =>
  i.kind === "issue"
    ? join(runs, i.issue, "issue")
    : join(runs, i.issue, "cl", i.name.replace(`${i.issue}-`, ""));

/** The attempt's run, and where its files go: the item's worktree, and the attempt's own folder. */
export function runOf(i: Item, n: number, runs: string): Run {
  const under = folderOf(i, runs);
  return { ...i, n, dir: join(under, String(n)), work: join(under, "work") };
}

/**
 * The parts of an attempt, one per repo it works in: itself, or, for an issue with several repos, one run per repo, its
 * worktree at work/<repo>, which its sandbox shows at /work/<repo>, and its folder under the item's repos/<repo>/.
 */
export function partsOf(r: Run): Run[] {
  if (!r.repos?.length) return [r];
  return r.repos.map((p) => ({
    ...r,
    repo: p.repo,
    image: p.image,
    test: p.test,
    setup: p.setup,
    repos: [],
    dir: join(dirname(r.dir), "repos", p.name, String(r.n)),
    work: join(r.work, p.name),
  }));
}

/** Appends a line to the attempt's log, its record of what the agent did. */
export function log(r: Run, line: string) {
  mkdirSync(r.dir, { recursive: true });
  appendFileSync(join(r.dir, "log"), `${line}\n`);
}
