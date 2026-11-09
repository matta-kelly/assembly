/**
 * Git: each item's branches, each attempt's worktree, its commits, and the merges.
 *
 * Each item has a branch, assembly/<name>/head, that holds its passed work. An attempt's worktree is a branch of its
 * own, assembly/<name>/<n>, made from the item's branch, else its issue's (the cls merged so far), else main. Both live
 * under assembly/<name>/, since git cannot hold a branch that is also another branch's folder. A pass commits the
 * attempt and moves the item's branch to it, so the next step starts from it. A failed attempt's branch is kept, as its
 * record.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Run } from "../process/step.ts";
import { must, sh } from "./sh.ts";

/** The branch that holds an item's passed work. */
export const branchOf = (name: string) => `assembly/${name}/head`;

/** The branch of one attempt. */
const attemptOf = (r: Run) => `assembly/${r.name}/${r.n}`;

/** Whether the repo has the branch. */
async function has(repo: string, branch: string) {
  const r = await sh("git", [
    "-C",
    repo,
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/heads/${branch}`,
  ]);
  return r.code === 0;
}

/** Where an attempt's worktree starts: the item's own passed work, then its issue's, then main. */
async function baseOf(r: Run): Promise<string> {
  for (const name of [r.name, r.issue])
    if (await has(r.repo, branchOf(name))) return branchOf(name);
  return "main";
}

/**
 * Makes the attempt's run folder and its worktree, or keeps the one it has. A worktree that is gone while git still has
 * its registration is pruned, and an attempt's branch that is there already is checked out again, with its commits.
 * Gives back whether it made one: a new worktree holds nothing a setup installed.
 */
export async function worktree(r: Run): Promise<boolean> {
  mkdirSync(r.dir, { recursive: true });
  if (existsSync(join(r.work, ".git"))) return false;
  await must("git", ["-C", r.repo, "worktree", "prune"]);
  await must(
    "git",
    (await has(r.repo, attemptOf(r)))
      ? ["-C", r.repo, "worktree", "add", r.work, attemptOf(r)]
      : [
          "-C",
          r.repo,
          "worktree",
          "add",
          "-b",
          attemptOf(r),
          r.work,
          await baseOf(r),
        ],
  );
  return true;
}

/**
 * Adds an approved cl to its issue's branch. A cl starts from its issue's branch and the cls run one at a time, so the
 * issue's branch is always behind the cl's, and it moves forward to it. An issue's branch that is not behind it is an
 * error: two cls ran at once. Gives back the files the cl changed, for the ledger's planned and actual paths.
 */
export async function merge(
  repo: string,
  cl: string,
  issue: string,
): Promise<string[]> {
  const head = (
    await must("git", ["-C", repo, "rev-parse", branchOf(cl)])
  ).trim();
  const onto = (await has(repo, branchOf(issue))) ? branchOf(issue) : "main";
  // The files the cl changed: its branch against where it merges.
  const files = (
    await must("git", ["-C", repo, "diff", "--name-only", onto, head])
  )
    .split("\n")
    .filter(Boolean);
  if (await has(repo, branchOf(issue))) {
    const behind = await sh("git", [
      "-C",
      repo,
      "merge-base",
      "--is-ancestor",
      branchOf(issue),
      head,
    ]);
    if (behind.code !== 0)
      throw new Error(
        `${branchOf(issue)} is not behind ${branchOf(cl)}: it can't move forward to it`,
      );
  }
  await must("git", [
    "-C",
    repo,
    "update-ref",
    `refs/heads/${branchOf(issue)}`,
    head,
  ]);
  return files;
}

/**
 * Commits what the agent left in the worktree, and moves the item's branch to it. Nothing to commit is not an error.
 * With `only`, a bound step's change files, it commits those and leaves the rest, such as what a test run wrote.
 */
export async function commit(r: Run, message: string, only?: string[]) {
  if (!only) await must("git", ["-C", r.work, "add", "-A"]);
  else {
    const keep = new Set(only);
    const these = (await touched(r)).filter((f) => keep.has(f));
    if (these.length)
      await must("git", ["-C", r.work, "add", "-A", "--", ...these]);
  }
  const staged = await sh("git", ["-C", r.work, "diff", "--cached", "--quiet"]);
  if (staged.code !== 0)
    await must("git", ["-C", r.work, "commit", "-m", message]);
  const head = (await must("git", ["-C", r.work, "rev-parse", "HEAD"])).trim();
  await must("git", [
    "-C",
    r.repo,
    "update-ref",
    `refs/heads/${branchOf(r.name)}`,
    head,
  ]);
}

/** The worktree's HEAD, or undefined when it has none: the end state an attempt's trace points at. */
export async function head(r: Run): Promise<string | undefined> {
  const at = await sh("git", ["-C", r.work, "rev-parse", "HEAD"]);
  return at.code === 0 ? at.out.trim() : undefined;
}

/**
 * The worktree's tree hash, with what is not committed: staged into a scratch index, so the worktree's own index is
 * left as it is.
 */
export async function treeOf(r: Run): Promise<string> {
  const index = join(r.dir, "check.index");
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    await must("git", ["-C", r.work, "read-tree", "HEAD"], env);
    await must("git", ["-C", r.work, "add", "-A"], env);
    return (await must("git", ["-C", r.work, "write-tree"], env)).trim();
  } finally {
    rmSync(index, { force: true });
  }
}

/**
 * Every file of the worktree that differs from where its attempt started (its HEAD: an agent never commits), staged,
 * changed, new or removed. Staged into a scratch index, so the worktree's own index is left as it is.
 */
export async function touched(r: Run): Promise<string[]> {
  const index = join(r.dir, "touched.index");
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    await must("git", ["-C", r.work, "read-tree", "HEAD"], env);
    await must("git", ["-C", r.work, "add", "-A"], env);
    const out = await must(
      "git",
      ["-C", r.work, "diff", "--cached", "--name-only", "HEAD"],
      env,
    );
    return out.split("\n").filter(Boolean);
  } finally {
    rmSync(index, { force: true });
  }
}

/** Which of `files` differ in the worktree from the item's branch, committed or not. */
export async function changed(r: Run, files: string[]): Promise<string[]> {
  const out = await must("git", [
    "-C",
    r.work,
    "diff",
    "--name-only",
    branchOf(r.name),
    "--",
    ...files,
  ]);
  return out.split("\n").filter(Boolean);
}
