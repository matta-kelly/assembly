/**
 * The sandbox: an attempt's container, with no network, that stays up for the attempt, its worktree mounted at /work
 * (read-only for a step that must not edit). The agent's loop runs outside it, in the orchestrator, and holds the key;
 * its tools exec into the sandbox, so the mount is the wall (LangChain's "sandbox as tool").
 *
 * A container outlives the orchestrator: an attempt a stopped orchestrator left keeps its container, kept if it runs and
 * started again if it stopped. One that is gone (a host restart) is run again on the same worktree.
 */

import type { Run } from "../process/step.ts";
import { must, type Ran, sh } from "./sh.ts";

const container = (r: Run) => `assembly-${r.name}-${r.n}`;

/**
 * Every container an attempt starts, the sandbox and the test runs: no network, the host's user as the image's node
 * (uid 1000), so what it writes in the worktree is the host user's, and a share of the CPU, so several run at once and
 * the machine stays usable. The same mapping and cap as the dev containers. An image with no USER would run as root.
 */
export const offline = [
  "--network",
  "none",
  "--userns=keep-id:uid=1000,gid=1000",
  "--user",
  "1000:1000",
  "-e",
  "HOME=/home/node",
  "--cpus=3",
  "--cpu-shares=256",
  "--security-opt",
  "label=disable",
];

/** Opens the attempt's sandbox on its worktree, or takes up the one it has. It stays up until close. */
export async function open(r: Run, o: { readOnly: boolean }) {
  const state = await sh("podman", [
    "container",
    "inspect",
    "--format",
    "{{.State.Running}}",
    container(r),
  ]);
  if (state.code === 0) {
    if (state.out.trim() !== "true")
      await must("podman", ["start", container(r)]);
    return;
  }
  const work = o.readOnly ? `${r.work}:/work:ro` : `${r.work}:/work`;
  await must("podman", [
    "run",
    "-d",
    "--name",
    container(r),
    "--memory",
    "4g",
    ...offline,
    "-v",
    work,
    "-w",
    "/work",
    r.image,
    "sleep",
    "infinity",
  ]);
}

/** Runs a shell script in the attempt's sandbox, from /work: `args` are its $1, $2..., and `stdin` its input. */
export function exec(
  r: Run,
  script: string,
  args: string[] = [],
  stdin?: string,
): Promise<Ran> {
  return sh(
    "podman",
    [
      "exec",
      "-i",
      "-w",
      "/work",
      container(r),
      "sh",
      "-c",
      script,
      "sh",
      ...args,
    ],
    stdin,
  );
}

/** Removes the attempt's sandbox. The worktree and its branch stay, as the attempt's record. */
export async function close(r: Run) {
  await sh("podman", ["rm", "-f", "--ignore", container(r)]);
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
