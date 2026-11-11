/**
 * A repo's settings, as the factory runs it, read from the repo itself, so an issue names only its repos and nothing
 * can disagree with them:
 * - the image: its `crate.toml`'s `image`, the one crate checks it in. `dev` is its own dev image: the host puts it on
 *   this machine with the repo's `scripts/dev-image.sh local`, which prints its tag, and passes the tag in, since the
 *   orchestrator's image has no engine of its own to build it
 * - the full suite: `scripts/check.sh all`, every set of its check
 * - the setup: `npm ci` from the dev image's cache, offline, when it has a lockfile; none when it has not
 */

import { existsSync, readFileSync } from "node:fs";
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

/**
 * The repo at `path`, with its settings, or why it can't be run. `dev` maps a repo's name to its dev image's tag, as
 * the host resolved it.
 */
export function settingsOf(
  path: string,
  dev: Record<string, string> = {},
): { ok: true; repo: Repo } | { ok: false; error: string } {
  const name = basename(path);
  const tomlPath = join(path, "crate.toml");
  if (!existsSync(tomlPath))
    return {
      ok: false,
      error: `${path} has no crate.toml: the factory runs repos on crate`,
    };
  const image = tomlValue(readFileSync(tomlPath, "utf8"), "image");
  if (!image) return { ok: false, error: `${tomlPath} names no image` };
  if (image === "dev" && !dev[name])
    return {
      ok: false,
      error: `${name}'s image is its dev image, and no tag was given for it: add it through \`just factory\`, which puts it on this machine`,
    };
  if (!existsSync(join(path, "scripts", "check.sh")))
    return {
      ok: false,
      error: `${path} has no scripts/check.sh, its full suite`,
    };
  return {
    ok: true,
    repo: {
      name,
      repo: path,
      image: image === "dev" ? (dev[name] as string) : image,
      test: fullSuite,
      setup: existsSync(join(path, "package-lock.json")) ? npmSetup : "",
    },
  };
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
