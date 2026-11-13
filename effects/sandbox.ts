/**
 * The sandbox: an attempt's container, que-pasa's Podman backend, with no network, its worktree mounted at /work
 * (read-only for a step that must not edit). The agent's loop runs outside it, in the orchestrator, and holds the key;
 * its tools work in the sandbox, so the mount is the wall (LangChain's "sandbox as tool"). This file is the policy:
 * what each container is given. que-pasa makes it, keeps it, and makes it again (podman()).
 *
 * A container outlives the orchestrator: it is named for its attempt, so a run taken up by a new process finds it,
 * kept if it runs and started again if it stopped. One that is gone (a host restart) is made again on the same worktree.
 */

import { podman, type Podman } from "@mku1tra/que-pasa/sandbox";
import type { Run } from "../process/step.ts";
import { sh } from "./sh.ts";

/**
 * What bounds every container an attempt starts, the sandbox and the test runs: no network, the host's user as the
 * image's node (uid 1000), so what it writes in the worktree is the host user's, and a share of the CPU, so several
 * run at once and the machine stays usable. The same mapping and cap as the dev containers. An image with no USER
 * would run as root.
 */
const limits = {
  network: "none",
  user: "1000:1000",
  cpus: 3,
  runArgs: [
    "--userns=keep-id:uid=1000,gid=1000",
    "-e",
    "HOME=/home/node",
    "--cpu-shares=256",
    "--security-opt",
    "label=disable",
  ],
} as const;

/** The limits as `podman run` flags, for a container that is not a sandbox: a check's test run. */
export const offline = [
  "--network",
  limits.network,
  "--user",
  limits.user,
  `--cpus=${limits.cpus}`,
  ...limits.runArgs,
];

/** The same limits without the network, for the move (effects/move.ts): the one container that has it, to install. */
export const online = [
  "--user",
  limits.user,
  `--cpus=${limits.cpus}`,
  ...limits.runArgs,
];

/** The attempt's sandbox. Made on its first use, and kept until close. */
export const boxOf = (r: Run, o: { readOnly: boolean }): Podman =>
  podman({
    name: `assembly-${r.name}-${r.n}`,
    image: r.image,
    mounts: [{ source: r.work, target: "/work", readOnly: o.readOnly }],
    memory: "4g",
    ...limits,
  });

/**
 * Opens the attempt's sandbox, or takes up the one it has: so an image that can't run fails the attempt before its
 * agent starts, and not at the agent's first tool call.
 */
export async function open(r: Run, o: { readOnly: boolean }) {
  const ran = await boxOf(r, o).execute("true");
  if (ran.exitCode !== 0)
    throw new Error(`exit ${ran.exitCode}: ${ran.output.slice(-400)}`);
}

/** Removes the attempt's sandbox. The item's worktree and branch stay, for its next attempt. */
export async function close(r: Run) {
  // its name is all a close needs
  await boxOf(r, { readOnly: false }).close();
}

/** The id of the image the attempt's sandbox runs, or undefined when podman does not have it. */
export async function imageOf(r: Run): Promise<string | undefined> {
  const at = await sh("podman", [
    "image",
    "inspect",
    "--format",
    "{{.Id}}",
    r.image,
  ]);
  return at.code === 0 ? at.out.trim() : undefined;
}
