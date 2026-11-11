/**
 * Git: each item's branches, each attempt's worktree, its commits, and main, where each cl lands (land.ts).
 *
 * Main is the land target's: the remote `git land` lands on, `local` when the repo has it, else `origin`. Each item
 * has a branch, assembly/<name>/head, that holds its passed work. An attempt's worktree is a branch of its own,
 * assembly/<name>/<n>, made from a cl's own branch, else from main, fetched as it is made. Both live
 * under assembly/<name>/, since git cannot hold a branch that is also another branch's folder. A pass commits the
 * attempt and moves the item's branch to it, so the next step starts from it. A failed attempt's branch is kept, as its
 * record.
 *
 * A bound attempt (nail, hammer) has a checkout: its worktree is a sparse checkout of its cl's checkout, so only those
 * paths are on disk, and a pass commits what it changed. Its tests run on the item's full worktree, beside the
 * attempts' folders, with that same change applied (stage), so the tree a test sees is the tree the pass commits.
 */

import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import type { Run } from "../process/step.ts";
import { partsOf } from "./runs.ts";
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

/** Whether a path is one of `entries`, or under a folder of them: how git's sparse checkout reads a plain path. */
export const within = (entries: string[], path: string) => {
  const p = normalize(path).replace(/\/+$/, "");
  return entries.some((e) => {
    const x = normalize(e).replace(/\/+$/, "");
    return p === x || p.startsWith(`${x}/`);
  });
};

/** A checkout's entries as sparse-checkout patterns: each anchored at the repo's root, a file or a folder. */
const patterns = (checkout: string[]) =>
  checkout.map((e) => `/${normalize(e).replace(/^\/+|\/+$/g, "")}`);

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
 * Where an attempt's worktree starts: a cl's own passed work, else main. An issue's steps only read, so an issue
 * always starts from main, where its cls have landed.
 */
async function baseOf(r: Run): Promise<string> {
  if (r.kind === "cl" && (await has(r.repo, branchOf(r.name))))
    return branchOf(r.name);
  return mainOf(r.repo);
}

/**
 * Makes the attempt's run folder and its worktree, or keeps the one it has. A worktree that is gone while git still has
 * its registration is pruned, and an attempt's branch that is there already is checked out again, with its commits.
 * Gives back whether it made one: a new worktree holds nothing a setup installed.
 */
export async function worktree(r: Run): Promise<boolean> {
  // An issue with several repos: a worktree of each, side by side in its own.
  if (r.repos?.length) {
    mkdirSync(r.work, { recursive: true });
    let made = false;
    for (const p of partsOf(r)) made = (await worktree(p)) || made;
    return made;
  }
  mkdirSync(r.dir, { recursive: true });
  if (existsSync(join(r.work, ".git"))) return false;
  await must("git", ["-C", r.repo, "worktree", "prune"]);
  // A sparse one is added with nothing on disk, its patterns set, then checked out: only its checkout's paths appear.
  const sparse = r.checkout ? ["--no-checkout"] : [];
  await must(
    "git",
    (await has(r.repo, attemptOf(r)))
      ? ["-C", r.repo, "worktree", "add", ...sparse, r.work, attemptOf(r)]
      : [
          "-C",
          r.repo,
          "worktree",
          "add",
          ...sparse,
          "-b",
          attemptOf(r),
          r.work,
          await baseOf(r),
        ],
  );
  if (r.checkout) {
    // In a linked worktree, git keeps the sparse setting in the worktree's own config, so the repo stays whole.
    await must("git", [
      "-C",
      r.work,
      "sparse-checkout",
      "set",
      "--no-cone",
      ...patterns(r.checkout),
    ]);
    await must("git", ["-C", r.work, "checkout"]);
  }
  return true;
}

/** The item's full worktree: one per cl, detached, beside its attempts' folders, where its tests run. */
export const fullOf = (r: Run) => join(dirname(r.dir), "full");

/** Makes the item's full worktree, or keeps the one it has. Gives back whether it made one. */
export async function full(r: Run): Promise<boolean> {
  if (existsSync(join(fullOf(r), ".git"))) return false;
  await must("git", ["-C", r.repo, "worktree", "prune"]);
  await must("git", [
    "-C",
    r.repo,
    "worktree",
    "add",
    "--detach",
    fullOf(r),
    await baseOf(r),
  ]);
  return true;
}

/**
 * A scratch index for the worktree, seeded from its own index: in a sparse worktree that one marks each path outside
 * the checkout skip-worktree, so `add -A` leaves those paths as they are and does not stage them as removed.
 */
async function scratch<T>(
  r: Run,
  name: string,
  use: (env: NodeJS.ProcessEnv) => Promise<T>,
): Promise<T> {
  const index = join(r.dir, name);
  const own = (
    await must("git", [
      "-C",
      r.work,
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "index",
    ])
  ).trim();
  copyFileSync(own, index);
  try {
    return await use({ ...process.env, GIT_INDEX_FILE: index });
  } finally {
    rmSync(index, { force: true });
  }
}

/**
 * The tree of a sparse attempt's HEAD with its changes: what a pass commits and what its tests see. Built in a scratch
 * index from HEAD, by path, so the worktree's own index is left as it is and no path outside the checkout is staged
 * as removed.
 */
async function changedTree(r: Run): Promise<string> {
  const these = await touched(r);
  const index = join(r.dir, "stage.index");
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    await must("git", ["-C", r.work, "read-tree", "HEAD"], env);
    if (these.length)
      await must(
        "git",
        ["-C", r.work, "update-index", "--add", "--remove", "--", ...these],
        env,
      );
    return (await must("git", ["-C", r.work, "write-tree"], env)).trim();
  } finally {
    rmSync(index, { force: true });
  }
}

/**
 * Puts the attempt's change into the item's full worktree: its HEAD, with what it changed. Files git
 * ignores there, as the installed dependencies, stay. Gives back the tree, the one the test run sees.
 */
export async function stage(r: Run): Promise<string> {
  const tree = await changedTree(r);
  await must("git", ["-C", fullOf(r), "read-tree", "-u", "--reset", tree]);
  return tree;
}

/**
 * Commits what the agent left in the worktree, and moves the item's branch to it. Nothing to commit is not an error.
 * A bound attempt commits the tree its tests saw.
 */
export async function commit(r: Run, message: string) {
  if (r.checkout) {
    const tree = await changedTree(r);
    const at = (await must("git", ["-C", r.work, "rev-parse", "HEAD"])).trim();
    const was = (
      await must("git", ["-C", r.work, "rev-parse", `${at}^{tree}`])
    ).trim();
    if (tree !== was) {
      const made = (
        await must("git", [
          "-C",
          r.work,
          "commit-tree",
          tree,
          "-p",
          at,
          "-m",
          message,
        ])
      ).trim();
      await must("git", ["-C", r.work, "update-ref", "HEAD", made]);
    }
  } else {
    await must("git", ["-C", r.work, "add", "-A"]);
    const staged = await sh("git", [
      "-C",
      r.work,
      "diff",
      "--cached",
      "--quiet",
    ]);
    if (staged.code !== 0)
      await must("git", ["-C", r.work, "commit", "-m", message]);
  }
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
  // An issue with several repos has no one HEAD: its folder holds a worktree of each.
  if (r.repos?.length) return undefined;
  const at = await sh("git", ["-C", r.work, "rev-parse", "HEAD"]);
  return at.code === 0 ? at.out.trim() : undefined;
}

/**
 * The worktree's tree hash, with what is not committed: staged into a scratch index, so the worktree's own index is
 * left as it is.
 */
export async function treeOf(r: Run): Promise<string> {
  return scratch(r, "check.index", async (env) => {
    await must("git", ["-C", r.work, "add", "-A"], env);
    return (await must("git", ["-C", r.work, "write-tree"], env)).trim();
  });
}

/**
 * Every file of the worktree that differs from where its attempt started (its HEAD: an agent never commits): changed,
 * new or removed, as git status sees it. In a sparse worktree it never counts a path outside the checkout as removed,
 * and it does count a file written outside it. A file git ignores is not one.
 */
export async function touched(r: Run): Promise<string[]> {
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
