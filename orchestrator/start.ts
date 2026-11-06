/**
 * Every command an attempt runs on the host: git and podman. start makes the attempt's run folder (runs/<cl>/<n>/), its
 * worktree, and its packet, then starts the agent's container and returns at once. The mounts are the wall: the
 * worktree (read-only for a step that must not edit), the packet read-only, and out/, with no network.
 *
 * Each cl has a branch, assembly/<cl>/head, that holds its passed work. An attempt's worktree is a branch of its own,
 * assembly/<cl>/<n>, made from the cl's branch (from main for its first). Both live under assembly/<cl>/, since git
 * cannot hold a branch that is also another branch's folder. A pass commits the attempt and moves the cl's
 * branch to it, so the next step starts from it. A failed attempt's branch is kept, as its record.
 */

import { execFile } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { resultOf, type Run, type Step } from "../process/step.ts";
import type { Item } from "./ledger.ts";

const exec = promisify(execFile);

/** An agent, as start runs it: the command its container runs, in the repo's image, from /work. */
export interface Agent {
  name: string;
  command: string;
}

/** The attempt's run, and where its files go under `runs`. */
export function runOf(i: Item, n: number, runs: string): Run {
  const dir = join(runs, i.cl, String(n));
  return {
    ...i,
    n,
    dir,
    work: join(dir, "work"),
    packet: join(dir, "packet"),
    out: join(dir, "out"),
  };
}

/** The branch that holds a cl's passed work. */
export const branchOf = (cl: string) => `assembly/${cl}/head`;

/** The branch of one attempt. */
const attemptOf = (r: Run) => `assembly/${r.cl}/${r.n}`;

const container = (r: Run) => `assembly-${r.cl}-${r.n}`;

const sandbox = [
  "--network",
  "none",
  "--userns=keep-id",
  "--security-opt",
  "label=disable",
];

async function exists(repo: string, branch: string) {
  return exec("git", [
    "-C",
    repo,
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/heads/${branch}`,
  ]).then(
    () => true,
    () => false,
  );
}

export async function start(
  r: Run,
  step: Step<{ word: "done" }>,
  agent: Agent,
) {
  mkdirSync(r.packet, { recursive: true });
  mkdirSync(r.out, { recursive: true });
  const base = (await exists(r.repo, branchOf(r.cl))) ? branchOf(r.cl) : "main";
  await exec("git", [
    "-C",
    r.repo,
    "worktree",
    "add",
    "-b",
    attemptOf(r),
    r.work,
    base,
  ]);
  copyFileSync(r.path, join(r.packet, "cl.md"));
  writeFileSync(
    join(r.packet, "result.schema.json"),
    JSON.stringify(z.toJSONSchema(resultOf(step)), null, 2),
  );
  const work =
    step.worktree === "ro" ? `${r.work}:/work:ro` : `${r.work}:/work`;
  await exec("podman", [
    "run",
    "-d",
    "--name",
    container(r),
    "--memory",
    "4g",
    ...sandbox,
    "-v",
    work,
    "-v",
    `${r.packet}:/packet:ro`,
    "-v",
    `${r.out}:/out`,
    "-w",
    "/work",
    r.image,
    "sh",
    "-c",
    agent.command,
  ]);
}

/** The container's status ("running", "exited", ...) and exit code, or null when it is gone. */
export async function status(
  r: Run,
): Promise<{ status: string; code: number } | null> {
  try {
    const { stdout } = await exec("podman", [
      "inspect",
      "-f",
      "{{.State.Status}} {{.State.ExitCode}}",
      container(r),
    ]);
    const [status = "", code = ""] = stdout.trim().split(" ");
    return { status, code: Number(code) };
  } catch {
    return null;
  }
}

/** Saves the container's log into the run folder, then removes the container. */
export async function collect(r: Run) {
  const { stdout, stderr } = await exec("podman", ["logs", container(r)], {
    maxBuffer: 16 << 20,
  });
  writeFileSync(join(r.dir, "log"), stdout + stderr);
  await exec("podman", ["rm", container(r)]);
}

/** Commits what the agent left in the worktree, and moves the cl's branch to it. Nothing to commit is not an error. */
export async function commit(r: Run, message: string) {
  await exec("git", ["-C", r.work, "add", "-A"]);
  const staged = await exec("git", [
    "-C",
    r.work,
    "diff",
    "--cached",
    "--quiet",
  ]).then(
    () => false,
    () => true,
  );
  if (staged) await exec("git", ["-C", r.work, "commit", "-m", message]);
  const { stdout } = await exec("git", ["-C", r.work, "rev-parse", "HEAD"]);
  await exec("git", [
    "-C",
    r.repo,
    "update-ref",
    `refs/heads/${branchOf(r.cl)}`,
    stdout.trim(),
  ]);
}

/** Runs the cl's test command in the repo's image, offline, and returns its exit code and output. */
export async function runTests(r: Run): Promise<{ code: number; out: string }> {
  const args = [
    "run",
    "--rm",
    ...sandbox,
    "-v",
    `${r.work}:/work`,
    "-w",
    "/work",
    r.image,
    "sh",
    "-c",
    r.test,
  ];
  try {
    const { stdout, stderr } = await exec("podman", args, {
      maxBuffer: 16 << 20,
    });
    return { code: 0, out: stdout + stderr };
  } catch (e) {
    const x = e as {
      code?: unknown;
      stdout?: string;
      stderr?: string;
      message: string;
    };
    return {
      code: typeof x.code === "number" ? x.code : 1,
      out: (x.stdout ?? "") + (x.stderr ?? "") || x.message,
    };
  }
}

/** Which of `files` differ in the worktree from the cl's branch, committed or not. */
export async function changed(r: Run, files: string[]): Promise<string[]> {
  const { stdout } = await exec("git", [
    "-C",
    r.work,
    "diff",
    "--name-only",
    branchOf(r.cl),
    "--",
    ...files,
  ]);
  return stdout.split("\n").filter(Boolean);
}
