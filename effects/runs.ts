/**
 * Run folders: each item's files, under its issue, so every trial of an issue is in one place. An item's folder holds
 * its one worktree, `work`; a folder per attempt, `<n>`, with the attempt's log (the orchestrator's own lines) and its
 * trace (each tool call); and, for each agent's conversation on the item, the run of its attempt going on
 * (`<agent>.run.json`).
 */

import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Item } from "../orchestrator/ledger.ts";
import type { Run, Tree } from "../process/step.ts";

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

/** What an agent's conversation on an item gives its tools, the same in every run on it. JSON, so que-pasa keeps it. */
export type Context = {
  item: string; // the item's name
  agent: string;
  folder: string; // the item's folder, beside its worktree, where the attempt's run is written
  readOnly: boolean; // its worktree is mounted read-only, as a review's
};

/** Where the attempt's run is written for its conversation: the item's folder. */
const runFile = (c: Pick<Context, "folder" | "agent">) =>
  join(c.folder, `${c.agent}.run.json`);

/**
 * The run of the conversation's last attempt that reached the agent, or undefined when it has none yet: a conversation
 * is made by its first run, so the next attempt goes on from it.
 */
export function last(c: Pick<Context, "folder" | "agent">): Run | undefined {
  try {
    return JSON.parse(readFileSync(runFile(c), "utf8")) as Run;
  } catch {
    return undefined;
  }
}

/** The run of the attempt going on in the conversation: what its tools and its box are of. */
export const current = (c: Context): Run =>
  JSON.parse(readFileSync(runFile(c), "utf8")) as Run;

/** Writes the attempt's run for its conversation, before the run: what its tools and its box read back. */
export function keep(c: Context, r: Run) {
  mkdirSync(c.folder, { recursive: true });
  writeFileSync(runFile(c), JSON.stringify(r));
}
