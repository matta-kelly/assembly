/**
 * A repo's settings, as the factory runs it, read from the repo's main, so an issue names nothing of them and nothing can
 * disagree with them. An issue that names no repos may change any repo on crate, and its planner picks:
 * - the image: its `crate.toml`'s `image`, the one crate checks it in. `dev` is its own dev image: the host puts it on
 *   this machine with the repo's `scripts/dev-image.sh local`, which prints its tag, and passes the tag in, since the
 *   orchestrator's image has no engine of its own to build it
 * - the full suite: `scripts/check.sh all`, every set of its check
 * - the setup: `npm ci` from the dev image's cache, offline, when it has a lockfile; none when it has not
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { Repo } from "../process/step.ts";

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
export const mainRef = "server/main";

/** How a repo is read: a file of its main, and whether it is on crate. Git's in the factory; a test's own in a test. */
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

/**
 * The repo at `path`, with its settings as its main holds them, where the factory builds from, or why it can't be run.
 * `dev` maps a repo's name to its dev image's tag, as the host resolved it.
 */
export function settingsOf(
  path: string,
  dev: Record<string, string> = {},
  read: Reader = gitReader,
): { ok: true; repo: Repo } | { ok: false; error: string } {
  const name = basename(path);
  const toml = read.file(path, "crate.toml");
  if (toml === undefined)
    return {
      ok: false,
      error: `${path} is not on crate: its ${mainRef} has no crate.toml`,
    };
  const image = tomlValue(toml, "image");
  if (!image)
    return { ok: false, error: `${name}'s crate.toml names no image` };
  if (image === "dev" && !dev[name])
    return {
      ok: false,
      error: `${name}'s image is its dev image, and no tag was given for it: add it through \`just factory\`, which puts it on this machine`,
    };
  if (read.file(path, "scripts/check.sh") === undefined)
    return {
      ok: false,
      error: `${name} has no scripts/check.sh, its full suite`,
    };
  return {
    ok: true,
    repo: {
      name,
      repo: path,
      image: image === "dev" ? (dev[name] as string) : image,
      test: fullSuite,
      setup: read.file(path, "package-lock.json") === undefined ? "" : npmSetup,
    },
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

/** The dev images' tags as the host passes them: `name=tag` pairs, comma-separated. */
export function devImagesOf(value: string | undefined): Record<string, string> {
  return Object.fromEntries(
    (value ?? "")
      .split(",")
      .map((pair) => pair.split("="))
      .filter((p): p is [string, string] => p.length === 2 && !!p[0] && !!p[1]),
  );
}
