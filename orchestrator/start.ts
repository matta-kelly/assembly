/**
 * Every command an attempt runs on the host: git and podman. open makes the attempt's run folder (runs/<cl>/<n>/), its
 * worktree, and its sandbox: a container with no network that stays up for the attempt, the worktree mounted at /work
 * (read-only for a step that must not edit). The agent's loop runs outside it, in the orchestrator, and holds the key;
 * its tools exec into the sandbox, so the mount is the wall (LangChain's "sandbox as tool").
 *
 * Each cl has a branch, assembly/<cl>/head, that holds its passed work. An attempt's worktree is a branch of its own,
 * assembly/<cl>/<n>, made from the cl's branch (from main for its first). Both live under assembly/<cl>/, since git
 * cannot hold a branch that is also another branch's folder. A pass commits the attempt and moves the cl's branch to
 * it, so the next step starts from it. A failed attempt's branch is kept, as its record.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { CheckRun, Run, Step } from "../process/step.ts";
import type { Item } from "./ledger.ts";

/** A command's exit code and its output, stdout then stderr. */
export interface Ran {
  code: number;
  out: string; // stdout and stderr, as a person or a model reads them
  stdout: string; // stdout alone: what a command gives back as data
}

/**
 * Runs a command, with `stdin` as its input and `env` as its environment, and gives back its exit code and output. It
 * never throws on a non-zero exit.
 */
export function sh(
  command: string,
  args: string[],
  stdin?: string,
  env?: NodeJS.ProcessEnv,
): Promise<Ran> {
  return new Promise((resolve, reject) => {
    // No input is no stdin at all: a pipe nobody reads fails with EPIPE when the command exits first.
    const child = spawn(command, args, {
      stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      ...(env ? { env } : {}),
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({ code: code ?? 1, out: stdout + stderr, stdout }),
    );
    if (child.stdin) {
      // A command may exit without reading all its input; its exit code says how it went.
      child.stdin.on("error", () => undefined);
      child.stdin.end(stdin);
    }
  });
}

/** Runs a command that must succeed, and gives back its output. */
async function must(
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  const r = await sh(command, args, undefined, env);
  if (r.code !== 0)
    throw new Error(
      `${command} ${args.join(" ")}: exit ${r.code}: ${r.out.slice(-400)}`,
    );
  return r.stdout;
}

/** The attempt's run, and where its files go: under its issue, so every trial of an issue is in one place. */
export function runOf(i: Item, n: number, runs: string): Run {
  const under =
    i.kind === "issue"
      ? join(runs, i.issue, "issue")
      : join(runs, i.issue, "cl", i.name.replace(`${i.issue}-`, ""));
  const dir = join(under, String(n));
  return { ...i, n, dir, work: join(dir, "work") };
}

/** The branch that holds a cl's passed work. */
export const branchOf = (name: string) => `assembly/${name}/head`;

/** The branch of one attempt. */
const attemptOf = (r: Run) => `assembly/${r.name}/${r.n}`;

const container = (r: Run) => `assembly-${r.name}-${r.n}`;

const offline = [
  "--network",
  "none",
  "--userns=keep-id",
  "--security-opt",
  "label=disable",
];

/** Whether the repo has the branch. */
async function has(repo: string, branch: string) {
  return (
    (
      await sh("git", [
        "-C",
        repo,
        "rev-parse",
        "--verify",
        "--quiet",
        `refs/heads/${branch}`,
      ])
    ).code === 0
  );
}

/**
 * Where an attempt's worktree starts: the item's own passed work, then its issue's (the cls merged so far), then main.
 */
async function baseOf(r: Run): Promise<string> {
  for (const name of [r.name, r.issue])
    if (await has(r.repo, branchOf(name))) return branchOf(name);
  return "main";
}

/**
 * Adds an approved cl to its issue's branch. A cl starts from its issue's branch and the cls run one at a time, so the
 * issue's branch is always behind the cl's, and it moves forward to it. An issue's branch that is not behind it is an
 * error: two cls ran at once. Gives back the files the cl changed, for the ledger's planned and actual paths.
 */
export async function merge(
  repo: string,
  cl: string,
  issue: string,
): Promise<string[]> {
  const head = (
    await must("git", ["-C", repo, "rev-parse", branchOf(cl)])
  ).trim();
  const onto = (await has(repo, branchOf(issue))) ? branchOf(issue) : "main";
  // The files the cl changed: its branch against where it merges.
  const files = (
    await must("git", ["-C", repo, "diff", "--name-only", onto, head])
  )
    .split("\n")
    .filter(Boolean);
  if (await has(repo, branchOf(issue))) {
    const behind = await sh("git", [
      "-C",
      repo,
      "merge-base",
      "--is-ancestor",
      branchOf(issue),
      head,
    ]);
    if (behind.code !== 0)
      throw new Error(
        `${branchOf(issue)} is not behind ${branchOf(cl)}: it can't move forward to it`,
      );
  }
  await must("git", [
    "-C",
    repo,
    "update-ref",
    `refs/heads/${branchOf(issue)}`,
    head,
  ]);
  return files;
}

/**
 * Makes the attempt's run folder, its worktree and its sandbox, or takes up the ones it has: an attempt a stopped
 * orchestrator left keeps its worktree, and its container, which outlives the orchestrator, is kept if it runs and
 * started again if it stopped. One gone (a host restart) is run again on the same worktree. The sandbox stays up until
 * close.
 */
export async function open(
  r: Run,
  step: Pick<Step<{ word: "done" }>, "worktree">,
) {
  mkdirSync(r.dir, { recursive: true });
  if (!existsSync(join(r.work, ".git"))) {
    // The worktree is gone, but git may still have its registration and its branch: a lost folder is pruned, and an
    // attempt's branch that is there already is checked out again, with its commits.
    await must("git", ["-C", r.repo, "worktree", "prune"]);
    await must(
      "git",
      (await has(r.repo, attemptOf(r)))
        ? ["-C", r.repo, "worktree", "add", r.work, attemptOf(r)]
        : [
            "-C",
            r.repo,
            "worktree",
            "add",
            "-b",
            attemptOf(r),
            r.work,
            await baseOf(r),
          ],
    );
  }
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
  const work =
    step.worktree === "ro" ? `${r.work}:/work:ro` : `${r.work}:/work`;
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

/** Appends a line to the attempt's log, its record of what the agent did. */
export function log(r: Run, line: string) {
  mkdirSync(r.dir, { recursive: true });
  appendFileSync(join(r.dir, "log"), `${line}\n`);
}

/** Commits what the agent left in the worktree, and moves the cl's branch to it. Nothing to commit is not an error. */
export async function commit(r: Run, message: string) {
  await must("git", ["-C", r.work, "add", "-A"]);
  const staged = await sh("git", ["-C", r.work, "diff", "--cached", "--quiet"]);
  if (staged.code !== 0)
    await must("git", ["-C", r.work, "commit", "-m", message]);
  const head = (await must("git", ["-C", r.work, "rev-parse", "HEAD"])).trim();
  await must("git", [
    "-C",
    r.repo,
    "update-ref",
    `refs/heads/${branchOf(r.name)}`,
    head,
  ]);
}

/** The worktree's HEAD, or undefined when it has none: the end state an attempt's trace points at. */
export async function head(r: Run): Promise<string | undefined> {
  const at = await sh("git", ["-C", r.work, "rev-parse", "HEAD"]);
  return at.code === 0 ? at.out.trim() : undefined;
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

/**
 * The worktree's tree hash, with what is not committed: staged into a scratch index, so the worktree's own index is
 * left as it is.
 */
async function treeOf(r: Run): Promise<string> {
  const index = join(r.dir, "check.index");
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    await must("git", ["-C", r.work, "read-tree", "HEAD"], env);
    await must("git", ["-C", r.work, "add", "-A"], env);
    return (await must("git", ["-C", r.work, "write-tree"], env)).trim();
  } finally {
    rmSync(index, { force: true });
  }
}

/** The most one test run may take, in seconds. */
export const checkLimitS = 15 * 60;

/**
 * Runs the item's test command in a container of its own, offline: the check never runs in the agent's sandbox. Gives
 * back its output, and the run as the ledger records it.
 */
export async function runTests(r: Run): Promise<Ran & { check: CheckRun }> {
  const tree = await treeOf(r);
  const at = Date.now();
  const ran = await sh("podman", [
    "run",
    "--rm",
    // a test run that never ends (a watch mode, a hang) is stopped, so it never holds its attempt
    "--timeout",
    String(checkLimitS),
    ...offline,
    "-v",
    `${r.work}:/work`,
    "-w",
    "/work",
    r.image,
    "sh",
    "-c",
    r.test,
  ]);
  const input = createHash("sha256")
    .update(JSON.stringify([tree, r.test, r.image]))
    .digest("hex");
  return {
    ...ran,
    check: {
      command: r.test,
      image: r.image,
      tree,
      input,
      code: ran.code,
      at,
      ms: Date.now() - at,
    },
  };
}

/** Which of `files` differ in the worktree from the cl's branch, committed or not. */
export async function changed(r: Run, files: string[]): Promise<string[]> {
  const out = await must("git", [
    "-C",
    r.work,
    "diff",
    "--name-only",
    branchOf(r.name),
    "--",
    ...files,
  ]);
  return out.split("\n").filter(Boolean);
}
