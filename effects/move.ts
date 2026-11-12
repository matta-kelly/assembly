/**
 * The move: a cl that waited on a package takes the version it waited for, before its first attempt. It installs the
 * package at that version in the cl's repo, from `registry`, in a container with the network, and commits the changed
 * `package.json` and lockfile on the cl's branch as `build(deps): <package> to <version>`: a build commit asks no
 * version of its own (crate's bump reads the type). Its attempts' setup stays offline: the move alone has the network.
 * One package per call; advance calls it for every version the cl's repo needs.
 *
 * The worktree is inside the repo, so the container reaches it at a host path, as every path the orchestrator hands
 * podman is one. It is removed when the move ends, and the branch stays.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { branchOf, mainOf } from "./git.ts";
import { online } from "./sandbox.ts";
import { must, sh } from "./sh.ts";

/** The image npm runs in: node, with the network. A repo's dev image is offline, for its attempts. */
const image = "docker.io/library/node:22.23.4-slim";

/** The most a move may take, in seconds. */
const limitS = 10 * 60;

/** The most of a failed install's output the error keeps: the tail, where npm says what went wrong. */
const tail = 1_500;

/** The cl a move is for: its name, which names its branch, and its repo. */
export interface Moving {
  name: string;
  repo: string;
}

/**
 * Moves `pkg` to `version` in `cl`'s repo, on its branch, from the registry at `registry`, and gives back the commit
 * it made. Throws with the command's output when the install fails.
 */
export async function move(
  cl: Moving,
  pkg: string,
  version: string,
  registry: string,
): Promise<string> {
  const branch = branchOf(cl.name);
  const base = await mainOf(cl.repo);
  // A path git does not have yet, inside the repo: unique, and mounted at the same path in the move's container.
  const work = mkdtempSync(join(cl.repo, ".assembly-move-"));
  rmSync(work, { recursive: true, force: true });
  try {
    const has = await sh("git", [
      "-C",
      cl.repo,
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/heads/${branch}`,
    ]);
    await must("git", [
      "-C",
      cl.repo,
      "worktree",
      "add",
      ...(has.code === 0 ? [work, branch] : ["-b", branch, work, base]),
    ]);
    const installed = await sh("podman", [
      "run",
      "--rm",
      "--timeout",
      String(limitS),
      ...online,
      "-v",
      `${work}:/work`,
      "-w",
      "/work",
      image,
      "npm",
      "install",
      `${pkg}@${version}`,
      "--save-exact=false",
      "--registry",
      registry,
      "--no-audit",
      "--no-fund",
    ]);
    if (installed.code !== 0) throw new Error(installed.out.slice(-tail));
    await must("git", ["-C", work, "add", "package.json", "package-lock.json"]);
    const staged = await sh("git", ["-C", work, "diff", "--cached", "--quiet"]);
    if (staged.code !== 0)
      await must("git", [
        "-C",
        work,
        "commit",
        "-m",
        `build(deps): ${pkg} to ${version}`,
      ]);
    return (await must("git", ["-C", work, "rev-parse", "HEAD"])).trim();
  } finally {
    await sh("git", ["-C", cl.repo, "worktree", "remove", "--force", work]);
    rmSync(work, { recursive: true, force: true });
  }
}
