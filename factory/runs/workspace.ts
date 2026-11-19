/**
 * The attempt's workspace: crate's, from the repo's own crate.toml, on the item's worktree. The factory knows nothing of
 * how a repo runs: crate makes the workspace (its dev image, its setup, its services, its network with no way out), and
 * every command an attempt runs, the agent's and the check's, runs in its tools member through `crate run`. So the
 * agent works where the check runs, warm as the repo's dev image makes it, and a language is never the factory's.
 *
 * An attempt's workspace comes up when the attempt is readied (up) and goes when it ends (down); a stopped orchestrator
 * leaves it up, and the next one takes it up again. An issue with several repos has one per repo. Its own steps only
 * read: their tools read its worktrees in place, and run nothing.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  type FileBackend,
  type Ran,
  type SandboxBackend,
  shellBackend,
} from "@mku1tra/que-pasa/sandbox";
import type { Run, TestRun, Tree } from "../line/step.ts";
import { treeOf } from "../repos/git.ts";
import { partsOf } from "./runs.ts";
import { sh } from "../sh.ts";

/** The most of a failed crate call's output its error keeps: the tail, where the failure is. */
const tail = 1_500;

/** The most of each stream a call keeps: its tail. */
const keep = 1_000_000;

/** Runs a command to its end, with `stdin` as its input. It never rejects on a non-zero exit, only when it can't start. */
function call(
  command: string,
  args: string[],
  o: { stdin?: string; signal?: AbortSignal; cwd?: string } = {},
): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: [o.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      ...(o.cwd === undefined ? {} : { cwd: o.cwd }),
      ...(o.signal === undefined ? {} : { signal: o.signal }),
    });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    const add = (s: "out" | "err") => (d: Buffer) => {
      let t = (s === "out" ? stdout : stderr) + d.toString("utf8");
      if (t.length > keep) {
        t = t.slice(-keep);
        truncated = true;
      }
      if (s === "out") stdout = t;
      else stderr = t;
    };
    child.stdout?.on("data", add("out"));
    child.stderr?.on("data", add("err"));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr, truncated }));
    if (child.stdin) {
      // A command that exits before it reads its input closes the pipe: its exit code says how it went.
      child.stdin.on("error", () => undefined);
      child.stdin.end(o.stdin);
    }
  });
}

/** crate, on the checkout `work`. */
const crate = (
  work: string,
  args: string[],
  o: { stdin?: string; signal?: AbortSignal } = {},
) => call("crate", ["-C", work, ...args], o);

/** A crate call that must pass: it throws with the tail of its output. */
async function must(work: string, args: string[], signal?: AbortSignal) {
  const ran = await crate(work, args, signal ? { signal } : {});
  if (ran.code !== 0)
    throw new Error(
      `crate ${args.join(" ")}: exit ${ran.code}: ${(ran.stdout + ran.stderr).slice(-tail)}`,
    );
  return ran.stdout.trim();
}

/**
 * Brings up the attempt's workspace, one per repo: made by crate up --attempt, or, when a stopped orchestrator left it,
 * its tools member started again, since crate makes an attempt's workspace once. One of the same name on another
 * worktree, an item's of the same name before, is taken down and made again: it holds none of this one's work.
 */
export async function up(r: Tree, signal?: AbortSignal) {
  for (const p of partsOf(r)) {
    let tools = await toolsOf(p);
    if (tools && !tools.mounts.includes(p.work)) {
      await must(p.work, ["down"]);
      tools = undefined;
    }
    if (tools === undefined) await must(p.work, ["up", "--attempt"], signal);
    else if (!tools.running) {
      const started = await sh("podman", ["start", tools.name]);
      if (started.code !== 0)
        throw new Error(
          `podman start ${tools.name}: ${started.out.slice(-tail)}`,
        );
    }
  }
}

/** The workspace's tools member: its name, whether it runs, its image, and what it mounts; undefined when it has none. */
async function toolsOf(r: Tree): Promise<
  | {
      name: string;
      running: boolean;
      image: string;
      id: string;
      mounts: string[];
    }
  | undefined
> {
  const name = await crate(r.work, ["name"]);
  if (name.code !== 0) return undefined;
  const tools = `${name.stdout.trim()}-tools`;
  const at = await sh("podman", [
    "container",
    "inspect",
    "--format",
    "{{.State.Running}} {{.ImageName}} {{.Image}}{{range .Mounts}} {{.Destination}}{{end}}",
    tools,
  ]);
  if (at.code !== 0) return undefined;
  const [running = "", image = "", id = "", ...mounts] = at.stdout
    .trim()
    .split(" ");
  return { name: tools, running: running === "true", image, id, mounts };
}

/** Takes the attempt's workspace down. The worktree and its branch stay, for the item's next attempt. */
export async function down(r: Tree) {
  for (const p of partsOf(r)) await must(p.work, ["down"]);
}

/**
 * The attempt's sandbox: the agent's tools, on its worktree. A repo's attempt runs each in its workspace's tools member
 * (crate run), so its shell is the check's. An issue with several repos is read in place, and runs nothing.
 */
export function boxOf(r: Tree): FileBackend {
  if (r.repos?.length) {
    const read: Partial<SandboxBackend> = shellBackend({
      id: r.name,
      root: r.work,
      exec: ({ script, args = [], stdin, signal }) =>
        call("sh", ["-c", script, "sh", ...args], {
          cwd: r.work,
          ...(stdin === undefined ? {} : { stdin }),
          ...(signal === undefined ? {} : { signal }),
        }),
    });
    delete read.execute;
    return read as FileBackend;
  }
  return shellBackend({
    id: r.name,
    root: r.work,
    exec: ({ script, args = [], stdin, signal }) =>
      crate(r.work, ["run", "--", "sh", "-c", script, "sh", ...args], {
        ...(stdin === undefined ? {} : { stdin }),
        ...(signal === undefined ? {} : { signal }),
      }),
  });
}

/** The image the attempt's workspace runs, by name and id, as podman has its tools member; undefined when it is not up. */
export async function imageOf(
  r: Tree,
): Promise<{ name: string; id: string } | undefined> {
  const tools = await toolsOf(r);
  return tools && { name: tools.image, id: tools.id };
}

/**
 * Runs `command` in the attempt's workspace, on its worktree, and records it with its inputs: the tree and the command,
 * since the tree holds the crate.toml that names the image. It stops when `signal` aborts.
 */
export async function runIn(
  r: Run,
  command: string,
  signal?: AbortSignal,
): Promise<TestRun> {
  const tree = await treeOf(r);
  const at = Date.now();
  const ran = await crate(
    r.work,
    ["run", "--", "sh", "-c", command],
    signal ? { signal } : {},
  );
  const code = ran.code ?? 1;
  const image = (await imageOf(r))?.name ?? "";
  return {
    code,
    out: ran.stdout + ran.stderr,
    check: {
      command,
      image,
      tree,
      input: createHash("sha256")
        .update(JSON.stringify([tree, command]))
        .digest("hex"),
      code,
      at,
      ms: Date.now() - at,
    },
  };
}

/**
 * Runs the item's full suite, the repo's own check, in its workspace. An issue with several repos runs each one's, in
 * its own: the first that fails is the run's result and its record; all pass, the last one's.
 */
export async function runTests(r: Run, signal?: AbortSignal): Promise<TestRun> {
  if (r.repos?.length) {
    const ran: TestRun[] = [];
    for (const p of partsOf(r)) {
      const t = await runTests(p, signal);
      ran.push({ ...t, out: `== ${p.repo}\n${t.out}` });
    }
    const failed = ran.find((t) => t.code !== 0);
    const last = ran.at(-1) as TestRun;
    return { ...(failed ?? last), out: ran.map((t) => t.out).join("\n") };
  }
  return runIn(r, r.test, signal);
}
