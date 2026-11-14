/**
 * A land target for an e2e repo: a bare repo on this machine as its `local` remote, which `git land` lands on with no
 * call to GitHub, and a GitHub-shaped `origin` that is never contacted, since `git land` wants one. Main is pushed to
 * it, so the repo's main is the target's.
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    timeout: 180_000,
  });

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

/**
 * A crate land target for an e2e repo: main's bare repo with crate's hooks on it (`crate init`, from CRATE_ROOT, crate's
 * install, its bin/ and hooks/), as the repo's `server` remote. The repo's crate.toml and check must be on its main
 * before this. Main is seeded as `crate apply` seeds it from GitHub: fetched into the bare repo, since no push makes it.
 */
export function crateTarget(repo: string, dir: string): string {
  const crate = process.env["CRATE_ROOT"];
  if (!crate) throw new Error("CRATE_ROOT names no crate install");
  const bare = join(dir, "server.git");
  execFileSync(join(crate, "bin", "crate"), ["init", bare], {
    timeout: 180_000,
  });
  // git land wants a GitHub origin, as every repo on the server has; it is never contacted
  git(
    repo,
    "remote",
    "add",
    "origin",
    "https://github.com/assembly-e2e/never-contacted.git",
  );
  git(repo, "remote", "add", "server", bare);
  execFileSync("git", ["-C", bare, "fetch", "-q", repo, "main:main"]);
  git(repo, "fetch", "-q", "server", "main");
  return bare;
}
