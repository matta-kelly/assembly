/**
 * An attempt's setup: the repo's dependencies installed into its new worktree, from the dev image's cache, with no
 * network, before any agent works in it. The command is the issue's (`--setup`), such as que-pasa's
 * `npm ci --offline --no-audit --no-fund`, the command its dev image's smoke proves (scripts/dev-image-smoke.sh).
 *
 * It runs in a container of its own, as a check's test run does (tests.ts), with the worktree mounted read-write: not
 * in the agent's sandbox, which a review mounts read-only. It runs once per worktree: `setup.done`, in the attempt's
 * folder, is written only when it passed, so an attempt taken up after a restart does not run it again under its
 * running agent (`npm ci` removes node_modules first), and one a stop cut off mid-setup runs it again.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Run } from "../process/step.ts";
import { touched } from "./git.ts";
import { offline } from "./sandbox.ts";
import { sh } from "./sh.ts";

/** The most a setup may take, in seconds. */
export const setupLimitS = 10 * 60;

/** The most of a failed setup's output its reason keeps: the tail, where the failure is. */
const tail = 1_500;

/** Where a passed setup is marked: the attempt's folder. */
const done = (r: Run) => join(r.dir, "setup.done");

/** Whether the attempt's worktree still needs its setup: it has one, and it has not passed. */
export const needsSetup = (r: Run) => r.setup !== "" && !existsSync(done(r));

/** Forgets a setup: the worktree was made again, with nothing installed. */
export const forgetSetup = (r: Run) => rmSync(done(r), { force: true });

/** The setup's container: named for its attempt, so one an abort left running is found and removed. */
const container = (r: Run) => `assembly-${r.name}-${r.n}-setup`;
const remove = (r: Run) =>
  sh("podman", ["rm", "--force", "--ignore", "--time", "0", container(r)]);

/**
 * Runs the attempt's setup on its worktree, and marks it done when it passes. Throws, with why, when it fails. A
 * cache that lacks a package of the lockfile (npm's ENOTCACHED) is named: the image is older than the lockfile. So is
 * a setup that leaves files git does not ignore: the scope check and the commits would take them for the agent's.
 * The podman client an abort stops leaves its container running, so it is removed: here, and before each setup.
 */
export async function runSetup(r: Run, signal?: AbortSignal) {
  await remove(r);
  const ran = await sh(
    "podman",
    [
      "run",
      "--rm",
      "--name",
      container(r),
      "--timeout",
      String(setupLimitS),
      ...offline,
      "-v",
      `${r.work}:/work`,
      "-w",
      "/work",
      r.image,
      "sh",
      "-c",
      r.setup,
    ],
    undefined,
    undefined,
    signal,
  ).catch(async (e: unknown) => {
    await remove(r);
    throw e;
  });
  if (ran.code !== 0) {
    const cause = /ENOTCACHED/.test(ran.out)
      ? `${r.image}'s cache lacks a package of this lockfile: the image is older than it. `
      : "";
    throw new Error(`${cause}exit ${ran.code}: ${ran.out.slice(-tail)}`);
  }
  const seen = await touched(r);
  if (seen.length)
    throw new Error(
      `it left files git does not ignore, which would count as the agent's: ${seen.slice(0, 10).join(", ")}${seen.length > 10 ? `, and ${seen.length - 10} more` : ""}`,
    );
  mkdirSync(r.dir, { recursive: true });
  writeFileSync(done(r), "");
}
