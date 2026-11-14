/**
 * The move: a cl that waited on a package takes the version it waited for, before its first attempt. It installs the
 * package at that version in the cl's worktree (git.ts, made from main when the cl has none yet), from `registry`, in a
 * container with the network, and commits the changed `package.json` and lockfile on the cl's branch as
 * `build(deps): <package> to <version>`: a build commit asks no version of its own (crate's bump reads the type). Its
 * attempts' setup stays offline: the move alone has the network. One package per call; advance calls it for every
 * version the cl's repo needs.
 */

import type { Tree } from "../line/step.ts";
import { worktree } from "./git.ts";
import { online } from "../runs/sandbox.ts";
import { must, sh } from "../sh.ts";

/** The image npm runs in: node, with the network. A repo's dev image is offline, for its attempts. */
const image = "docker.io/library/node:22.23.4-slim";

/** The most a move may take, in seconds. */
const limitS = 10 * 60;

/** The most of a failed install's output the error keeps: the tail, where npm says what went wrong. */
const tail = 1_500;

/**
 * Moves `pkg` to `version` in the cl's worktree, on its branch, from the registry at `registry`, and gives back the
 * commit it made. Throws with the command's output when the install fails.
 */
export async function move(
  cl: Tree,
  pkg: string,
  version: string,
  registry: string,
): Promise<string> {
  await worktree(cl);
  const installed = await sh("podman", [
    "run",
    "--rm",
    "--timeout",
    String(limitS),
    ...online,
    "-v",
    `${cl.work}:/work`,
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
  await must("git", [
    "-C",
    cl.work,
    "add",
    "package.json",
    "package-lock.json",
  ]);
  const staged = await sh("git", [
    "-C",
    cl.work,
    "diff",
    "--cached",
    "--quiet",
  ]);
  if (staged.code !== 0)
    await must("git", [
      "-C",
      cl.work,
      "commit",
      "-q",
      "-m",
      `build(deps): ${pkg} to ${version}`,
    ]);
  return (await must("git", ["-C", cl.work, "rev-parse", "HEAD"])).trim();
}
