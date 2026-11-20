/**
 * The factory's clones: one of each repo crate serves, under ASSEMBLY_REPOS, with crate's bare repo as its `server`
 * remote. crate's own declaration names those repos (the REPOS line of its env file), so a repo added to crate gets its
 * clone on the factory's next tick, with no step by hand. A clone there already is left as it is: the factory fetches
 * and moves it itself (git.ts).
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

/** The repos crate serves: the REPOS line of its env file, `REPOS="a b c"`. None when the line is not there. */
export function servedBy(envFile: string): string[] {
  const line = readFileSync(envFile, "utf8")
    .split("\n")
    .find((l) => /^REPOS=/.test(l.trim()));
  if (!line) return [];
  return line
    .trim()
    .slice("REPOS=".length)
    .replace(/^["']|["']$/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

/** How a clone is made: git's in the factory, a test's own in a test. */
export type Clone = (url: string, into: string) => Promise<void>;

const gitClone: Clone = async (url, into) => {
  await promisify(execFile)("git", ["clone", "-q", "-o", "server", url, into]);
};

/**
 * Clones each repo of `names` that has no clone under `root`, from `<base>/<name>.git`. A repo that does not clone is
 * named with its error, and the others still clone: the next tick tries it again.
 */
export async function keepClones(
  root: string,
  names: string[],
  base: string,
  clone: Clone = gitClone,
): Promise<{ cloned: string[]; failed: { name: string; error: string }[] }> {
  const cloned: string[] = [];
  const failed: { name: string; error: string }[] = [];
  for (const name of names) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) {
      failed.push({ name, error: "not a repo name" });
      continue;
    }
    const into = join(root, name);
    if (existsSync(join(into, ".git"))) continue;
    try {
      await clone(`${base}/${name}.git`, into);
      cloned.push(name);
    } catch (e) {
      failed.push({ name, error: (e as Error).message.split("\n")[0] ?? "" });
    }
  }
  return { cloned, failed };
}
