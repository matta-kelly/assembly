/**
 * A land target for an e2e repo: a bare repo on this machine as its `local` remote, which `git land` lands on with no
 * call to GitHub, and a GitHub-shaped `origin` that is never contacted, since `git land` wants one. Main is pushed to
 * it, so the repo's main is the target's.
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });

/** Gives `repo` its land target, a bare repo in `dir`, and gives back the target's path. */
export function landTarget(repo: string, dir: string): string {
  const bare = join(dir, "main.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
  git(
    repo,
    "remote",
    "add",
    "origin",
    "https://github.com/assembly-e2e/never-contacted.git",
  );
  git(repo, "remote", "add", "local", bare);
  git(repo, "push", "-q", "local", "main");
  return bare;
}
