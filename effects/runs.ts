/**
 * Run folders: each attempt's files, under its issue, so every trial of an issue is in one place. An attempt's folder
 * holds its worktree, its log (the orchestrator's own lines) and its trace (each tool call).
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Item } from "../orchestrator/ledger.ts";
import type { Run } from "../process/step.ts";

/** The attempt's run, and where its files go: runs/<issue>/issue/<n>/, or runs/<issue>/cl/<cut>/<n>/. */
export function runOf(i: Item, n: number, runs: string): Run {
  const under =
    i.kind === "issue"
      ? join(runs, i.issue, "issue")
      : join(runs, i.issue, "cl", i.name.replace(`${i.issue}-`, ""));
  const dir = join(under, String(n));
  return { ...i, n, dir, work: join(dir, "work") };
}

/**
 * The parts of an attempt, one per repo it works in: itself, or, for an issue with several repos, one run per repo, its
 * worktree at work/<repo>, which its sandbox shows at /work/<repo>, and its own folder for its setup's mark.
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
    dir: join(r.dir, "repos", p.name),
    work: join(r.work, p.name),
  }));
}

/** Appends a line to the attempt's log, its record of what the agent did. */
export function log(r: Run, line: string) {
  mkdirSync(r.dir, { recursive: true });
  appendFileSync(join(r.dir, "log"), `${line}\n`);
}
