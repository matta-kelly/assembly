/**
 * A repo's settings, as the factory runs it, read from the item's worktree at each attempt, so an issue names nothing
 * of them and nothing can disagree with them. An issue that names no repos may change any repo on crate, and its
 * planner picks:
 * - the image: its `crate.toml`'s `image`, the one crate checks it in. `dev` is its own dev image, which crate makes
 *   from the worktree, in the orchestrator's image, from crate's install the host mounts there (devImage)
 * - the full suite: `scripts/check.sh all`, every set of its check
 * - the setup: `npm ci` from the dev image's cache, offline, when it has a lockfile; none when it has not
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Repo } from "../line/step.ts";
import { sh } from "../sh.ts";

/** The image an issue's own steps run in when it has several repos: they only read. Assembly's own check's. */
export const readerImage =
  "docker.io/library/node@sha256:63538dfe497cc29dfafdda25ada09b46db68a3f4cc205abf1f5d6bf0913f3384";

/** The setup of a repo with a lockfile: what the dev images' smoke proves (scripts/dev-image-smoke.sh). */
export const npmSetup = "npm ci --offline --no-audit --no-fund";

/** The full suite of a repo on crate. */
export const fullSuite = "scripts/check.sh all";

/** A value of crate.toml, as `key = "value"`; undefined when it has none. */
function tomlValue(toml: string, key: string): string | undefined {
  return new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, "m").exec(toml)?.[1];
}

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

/** A repo that is not on crate as the factory runs it: no crate.toml, no image, or no full suite. */
export class NotOnCrate extends Error {}

/** crate's failure: the exit code it gave, and its output, as a person reads it. */
export class CrateError extends Error {
  readonly exitCode: number;
  readonly output: string;
  constructor(exitCode: number, output: string) {
    super(output);
    this.exitCode = exitCode;
    this.output = output;
  }
}

/**
 * The settings of the repo `name` in the worktree `work`, as its files there hold them: its image, a dev repo's made
 * by crate from the worktree; its full suite; and its setup. Throws a NotOnCrate when the worktree has no crate.toml,
 * no image or no scripts/check.sh, and a CrateError when crate cannot make the dev image.
 */
export async function settingsAt(
  work: string,
  name: string,
): Promise<Pick<Repo, "image" | "test" | "setup">> {
  const file = (f: string) =>
    existsSync(join(work, f)) ? readFileSync(join(work, f), "utf8") : undefined;
  const toml = file("crate.toml");
  if (toml === undefined)
    throw new NotOnCrate(`${name} is not on crate: it has no crate.toml`);
  const image = tomlValue(toml, "image");
  if (!image) throw new NotOnCrate(`${name}'s crate.toml names no image`);
  if (file("scripts/check.sh") === undefined)
    throw new NotOnCrate(`${name} has no scripts/check.sh, its full suite`);
  return {
    image: image === "dev" ? await devImage(work) : image,
    test: fullSuite,
    setup: file("package-lock.json") === undefined ? "" : npmSetup,
  };
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

/**
 * The tag of the dev image crate makes from the worktree `work`: `crate dev-image local`, run in the orchestrator's
 * image from the host's crate install. The repo's crate.toml names the image (`name`) and the files its hash covers
 * (`[dev] inputs`). Its last line of output is the tag. A failure, or no tag, is
 * a CrateError, with crate's output and exit code.
 */
export async function devImage(work: string): Promise<string> {
  const ran = await sh("crate", ["-C", work, "dev-image", "local"]).catch(
    (e: unknown) => {
      throw new CrateError(127, `crate: ${(e as Error).message}`);
    },
  );
  const tag =
    ran.stdout
      .split("\n")
      .filter((line) => line.trim())
      .at(-1)
      ?.trim() ?? "";
  if (ran.code !== 0 || tag === "")
    throw new CrateError(ran.code || 1, ran.out.trim());
  return tag;
}
