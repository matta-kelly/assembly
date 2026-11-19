/**
 * A repo's settings, as the factory runs it, read from the item's worktree at each attempt, so an issue names nothing
 * of them and nothing can disagree with them. An issue that names no repos may change any repo on crate, and its
 * planner picks. A repo is on crate as the factory runs it when its worktree has a `crate.toml`, from which crate makes
 * each attempt's workspace (factory/runs/workspace.ts), and its full suite, `scripts/check.sh all`, every set of its
 * check. How it runs, its image and its setup, is crate's alone.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Repo } from "../line/step.ts";

/** The full suite of a repo on crate. */
export const fullSuite = "scripts/check.sh all";

/** Where a repo on crate keeps main: its `server` remote, crate's bare repo on the server. */
const mainRef = "server/main";

/**
 * How a repo is read: a file of its main, and whether it is on crate. Git's in the factory; a test's own in a test.
 * What a waiting cl's repo depends on, and what a landed package is named, are read this way (factory/line/advance.ts).
 */
export interface Reader {
  file(path: string, file: string): string | undefined;
  onCrate(path: string): boolean;
}

/** The repo as git has it: a file of its main, or undefined when main lacks it; on crate when it has a `server` remote. */
export const gitReader: Reader = {
  file(path, file) {
    try {
      return execFileSync("git", ["-C", path, "show", `${mainRef}:${file}`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      return undefined;
    }
  },
  onCrate(path) {
    try {
      execFileSync("git", ["-C", path, "remote", "get-url", "server"], {
        stdio: "ignore",
      });
      return true;
    } catch {
      return false;
    }
  },
};

/** A repo that is not on crate as the factory runs it: no crate.toml, or no full suite. */
export class NotOnCrate extends Error {}

/**
 * The settings of the repo `name` in the worktree `work`: its full suite. Throws a NotOnCrate when the worktree has no
 * crate.toml or no scripts/check.sh.
 */
export function settingsAt(
  work: string,
  name: string,
): Promise<Pick<Repo, "test">> {
  if (!existsSync(join(work, "crate.toml")))
    return Promise.reject(
      new NotOnCrate(`${name} is not on crate: it has no crate.toml`),
    );
  if (!existsSync(join(work, "scripts/check.sh")))
    return Promise.reject(
      new NotOnCrate(`${name} has no scripts/check.sh, its full suite`),
    );
  return Promise.resolve({ test: fullSuite });
}

/**
 * Every repo on crate under `root`, to three folders down: a git repo with a `server` remote. The repos an issue may
 * change when it names none, so the planner picks among them.
 */
export function reposOn(root: string, read: Reader = gitReader): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (existsSync(join(dir, ".git")) && read.onCrate(dir)) found.push(dir);
    if (depth === 3) return;
    for (const e of readdirSync(dir, { withFileTypes: true }))
      if (
        e.isDirectory() &&
        !e.name.startsWith(".") &&
        e.name !== "node_modules"
      )
        walk(join(dir, e.name), depth + 1);
  };
  walk(root, 0);
  return found.sort();
}
