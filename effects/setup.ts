/**
 * A worktree's setup: the repo's dependencies installed into the item's new worktree, from the dev image's cache, with
 * no network, before any agent works in it. The command is the repo's, such as que-pasa's
 * `npm ci --offline --no-audit --no-fund`, the command its dev image's smoke proves (scripts/dev-image-smoke.sh). An
 * issue with several repos sets up each one's worktree with its own.
 *
 * It runs in a container of its own, as a check's test run does (tests.ts), with the worktree mounted read-write: not
 * in the agent's sandbox, which a review mounts read-only. It runs once per worktree: `setup.done`, in the item's
 * folder beside the worktree, is written only when it passed, so a later attempt, or one taken up after a restart,
 * does not run it again (`npm ci` removes node_modules first), and one a stop cut off mid-setup runs it again.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Run } from "../process/step.ts";
import { touched } from "./git.ts";
import { partsOf } from "./runs.ts";
import { offline } from "./sandbox.ts";
import { sh } from "./sh.ts";

/** The most a setup may take, in seconds. */
export const setupLimitS = 10 * 60;

/** The most of a failed setup's output its reason keeps: the tail, where the failure is. */
const tail = 1_500;

/** Where a passed setup is marked: the item's folder, beside its worktree, above the attempt's. */
const done = (r: Run) => join(dirname(r.dir), "setup.done");

/** Whether the item's worktree still needs its setup: it has one, and it has not passed. */
export const needsSetup = (r: Run): boolean =>
  r.repos?.length
    ? partsOf(r).some(needsSetup)
    : r.setup !== "" && !existsSync(done(r));

/** Forgets a setup: the worktree was made again, with nothing installed. */
export const forgetSetup = (r: Run) => {
  for (const p of partsOf(r)) rmSync(done(p), { force: true });
};

/** The setup's container: named for its attempt, so one an abort left running is found and removed. */
const container = (r: Run) => `assembly-${r.name}-${r.n}-setup`;
const remove = (r: Run) =>
  sh("podman", ["rm", "--force", "--ignore", "--time", "0", container(r)]);

/**
 * Runs the setup on the item's worktree, and marks it done when it passes. Throws, with why, when it fails. A cache
 * that lacks a package of the lockfile (npm's ENOTCACHED) is named: the image is older than the lockfile. So is a
 * setup that leaves files git does not ignore: the commits would take them for the agent's.
 * The podman client an abort stops leaves its container running, so it is removed: here, and before each setup.
 */
export async function runSetup(r: Run, signal?: AbortSignal) {
  // An issue with several repos: each repo's own setup, in its own image, on its own worktree.
  if (r.repos?.length) {
    for (const p of partsOf(r).filter(needsSetup)) await runSetup(p, signal);
    return;
  }
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
  mkdirSync(dirname(done(r)), { recursive: true });
  writeFileSync(done(r), "");
}
