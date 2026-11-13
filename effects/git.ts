/**
 * Git: each item's one worktree and branch, its commits, main, where each cl lands (land.ts), and the sweep that keeps
 * nothing else.
 *
 * Main is the land target's: the remote `git land` lands on, `server` or `local` when the repo has it, else `origin`.
 * A cl has one branch, assembly/<name>/head, that holds its passed work, and one worktree on it, beside its attempts'
 * folders, made from main when the cl first needs it. Every step of the cl works there: a pass commits on the branch,
 * and any other end of a step that writes keeps its change as the attempt's record (change.diff) and resets the
 * worktree to the branch. An issue's worktree is detached, and moves to main as it is now at each attempt. A live item
 * has its branch and its worktree; the sweep removes every other one under assembly/ and under the runs folder.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, normalize, relative } from "node:path";
import type { Tree } from "../process/step.ts";
import { partsOf } from "./runs.ts";
import { must, sh } from "./sh.ts";

/** The branch that holds an item's passed work. */
export const branchOf = (name: string) => `assembly/${name}/head`;

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

/** Whether a path is one of `entries`, or under a folder of them: a plain path, matched as git matches one. */
export const within = (entries: string[], path: string) => {
  const p = normalize(path).replace(/\/+$/, "");
  return entries.some((e) => {
    const x = normalize(e).replace(/\/+$/, "");
    return p === x || p.startsWith(`${x}/`);
  });
};

/**
 * The remote a cl lands on: `server`, main's bare repo guarded by crate's hooks, when the repo has it; else `local`, a
 * bare repo on this machine, as `git land` picks it; else `origin`.
 */
export async function targetOf(repo: string): Promise<string> {
  for (const remote of ["server", "local"]) {
    const has = await sh("git", ["-C", repo, "remote", "get-url", remote]);
    if (has.code === 0) return remote;
  }
  return "origin";
}

/** Main as the land target has it now: fetched, and named as its remote-tracking branch. */
export async function mainOf(repo: string): Promise<string> {
  const remote = await targetOf(repo);
  await must("git", ["-C", repo, "fetch", "-q", remote, "main"]);
  return `${remote}/main`;
}

/**
 * Makes the item's worktree, or keeps the one it has: a cl's on its branch, made from main when it has none; an
 * issue's detached at main. A worktree that is gone while git still has its registration is pruned. Gives back
 * whether it made one: a new worktree holds nothing a setup installed.
 */
export async function worktree(r: Tree): Promise<boolean> {
  // An issue with several repos: a worktree of each, side by side in its own.
  if (r.repos?.length) {
    mkdirSync(r.work, { recursive: true });
    let made = false;
    for (const p of partsOf(r)) made = (await worktree(p)) || made;
    return made;
  }
  if (existsSync(join(r.work, ".git"))) return false;
  await must("git", ["-C", r.repo, "worktree", "prune"]);
  const add = ["-C", r.repo, "worktree", "add", "-q"];
  if (r.kind === "issue")
    await must("git", [...add, "--detach", r.work, await mainOf(r.repo)]);
  else if (await has(r.repo, branchOf(r.name)))
    await must("git", [...add, r.work, branchOf(r.name)]);
  else
    await must("git", [
      ...add,
      "-b",
      branchOf(r.name),
      r.work,
      await mainOf(r.repo),
    ]);
  return true;
}

/**
 * Makes or keeps a worktree on the item's branch, and puts the branch at main as the land target has it now, with
 * nothing else in it: where the orchestrator writes the notes an issue's land commits and lands.
 */
export async function onMain(r: Tree) {
  const main = await mainOf(r.repo);
  if (!existsSync(join(r.work, ".git"))) {
    await must("git", ["-C", r.repo, "worktree", "prune"]);
    await must("git", [
      "-C",
      r.repo,
      "worktree",
      "add",
      "-q",
      "-B",
      branchOf(r.name),
      r.work,
      main,
    ]);
    return;
  }
  await must("git", [
    "-C",
    r.work,
    "checkout",
    "-q",
    "-f",
    "-B",
    branchOf(r.name),
    main,
  ]);
  await must("git", ["-C", r.work, "clean", "-q", "-f", "-d"]);
}

/**
 * Moves an issue's worktree to main as the land target has it now: its cls land there, and its steps only read. Gives
 * back whether it moved, so a setup on the main before is run again.
 */
export async function fresh(r: Tree): Promise<boolean> {
  let moved = false;
  for (const p of partsOf(r)) {
    const was = await head(p);
    await must("git", [
      "-C",
      p.work,
      "checkout",
      "-q",
      "--force",
      "--detach",
      await mainOf(p.repo),
    ]);
    moved = (await head(p)) !== was || moved;
  }
  return moved;
}

/** Commits what the agent left in the worktree, on its branch, so the next step starts from it. Nothing to commit is not an error. */
export async function commit(r: Tree, message: string) {
  await must("git", ["-C", r.work, "add", "-A"]);
  const staged = await sh("git", ["-C", r.work, "diff", "--cached", "--quiet"]);
  if (staged.code !== 0)
    await must("git", ["-C", r.work, "commit", "-q", "-m", message]);
}

/**
 * Ends an attempt that did not pass: its change, new files too, is kept in its folder as its record (change.diff, or
 * <repo>.diff for each repo of an issue with several), and the worktree goes back to its HEAD. Files git ignores, as
 * the installed dependencies, stay.
 */
export async function discard(r: Tree) {
  for (const p of partsOf(r)) {
    await must("git", ["-C", p.work, "add", "-A"]);
    const diff = await must("git", [
      "-C",
      p.work,
      "diff",
      "--cached",
      "--binary",
      "HEAD",
    ]);
    if (diff) {
      mkdirSync(r.dir, { recursive: true });
      const name = r.repos?.length ? `${basename(p.work)}.diff` : "change.diff";
      writeFileSync(join(r.dir, name), diff);
    }
    await must("git", ["-C", p.work, "reset", "-q", "--hard", "HEAD"]);
    await must("git", ["-C", p.work, "clean", "-q", "-f", "-d"]);
  }
}

/** The worktree's HEAD, or undefined when it has none: the end state an attempt's trace points at. */
export async function head(r: Tree): Promise<string | undefined> {
  // An issue with several repos has no one HEAD: its folder holds a worktree of each.
  if (r.repos?.length) return undefined;
  const at = await sh("git", ["-C", r.work, "rev-parse", "HEAD"]);
  return at.code === 0 ? at.out.trim() : undefined;
}

/**
 * The worktree's tree hash, with what is not committed: staged into a scratch index in the attempt's folder, so the
 * worktree's own index is left as it is.
 */
export async function treeOf(r: Tree): Promise<string> {
  mkdirSync(r.dir, { recursive: true });
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
 * Every file of the worktree that differs from where its attempt started, its HEAD (a failed attempt resets to it):
 * changed, new or removed, as git status sees it. A file git ignores is not one.
 */
export async function touched(r: Tree): Promise<string[]> {
  const out = await must("git", [
    "-C",
    r.work,
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--no-renames",
  ]);
  return out
    .split("\0")
    .filter(Boolean)
    .map((line) => line.slice(3));
}

/** Which of `files` differ in the worktree from the item's branch, its HEAD, committed or not. */
export async function changed(r: Tree, files: string[]): Promise<string[]> {
  const out = await must("git", [
    "-C",
    r.work,
    "diff",
    "--name-only",
    "HEAD",
    "--",
    ...files,
  ]);
  return out.split("\n").filter(Boolean);
}

/** A version tag crate puts on a commit: `v<version>` for the package at `.`, `<folder>-v<version>` for one in a folder. */
const versionTag = /^(?:(.+)-)?v(\d+\.\d+\.\d+\S*)$/;

/** The version tags the land target of `repo` holds on `commit`, the commit main took for a cl. Never the local tags. */
export async function landedTags(
  repo: string,
  commit: string,
): Promise<string[]> {
  const remote = await targetOf(repo);
  const out = await must("git", ["-C", repo, "ls-remote", "--tags", remote]);
  // An annotated tag is listed twice: itself, and its commit as `<tag>^{}`. A light tag is listed once, as its commit.
  const tags = new Set<string>();
  for (const line of out.split("\n")) {
    const [sha, ref] = line.split("\t");
    if (sha !== commit || !ref?.startsWith("refs/tags/")) continue;
    const tag = ref.slice("refs/tags/".length).replace(/\^\{\}$/, "");
    if (versionTag.test(tag)) tags.add(tag);
  }
  return [...tags];
}

/**
 * The sweep of one repo: removes every worktree under `runs` that is not in `keep`, then every assembly/ branch not
 * in `branches`. What an item left when it ended, what a crash between moves left, and what an older scheme made all
 * go by this one rule. A worktree outside the runs folder is never touched. Safe to run again. One removal that fails
 * stops none of the others: it throws at the end, with each failure, for the caller to log.
 */
export async function sweep(
  repo: string,
  runs: string,
  keep: Set<string>,
  branches: Set<string>,
) {
  const failed: string[] = [];
  const remove = async (args: string[]) => {
    const r = await sh("git", ["-C", repo, ...args]);
    if (r.code !== 0) failed.push(`git ${args.join(" ")}: ${r.out.trim()}`);
  };
  await must("git", ["-C", repo, "worktree", "prune"]);
  const listed = await must("git", [
    "-C",
    repo,
    "worktree",
    "list",
    "--porcelain",
  ]);
  for (const line of listed.split("\n")) {
    if (!line.startsWith("worktree ")) continue;
    const path = normalize(line.slice("worktree ".length));
    const under = relative(runs, path);
    if (!under || under.startsWith("..") || keep.has(path)) continue;
    await remove(["worktree", "remove", "--force", path]);
  }
  const refs = await must("git", [
    "-C",
    repo,
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads/assembly/",
  ]);
  for (const branch of refs.split("\n").filter(Boolean))
    if (!branches.has(branch)) await remove(["branch", "-q", "-D", branch]);
  if (failed.length) throw new Error(failed.join("\n"));
}
