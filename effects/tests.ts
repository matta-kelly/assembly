/**
 * Test runs: the item's test command, in a container of its own, offline, on the item's worktree, with what the
 * attempt changed in it. A test run never runs in the agent's sandbox, and the agent's `test` tool and its step's check
 * are the same op, on the tree a pass commits. Each run is recorded with its inputs (the tree, the command and the
 * image), so the same inputs could be looked up again.
 *
 * A cl's red run (runRed) is its tests without its code: da-nail's check, and da-nail's own `test`. Red proves the tests
 * fail without the cl's code, so it runs where that code is not, whatever the worktree holds.
 */

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, normalize } from "node:path";
import type { Run, TestRun } from "../process/step.ts";
import { mainOf, treeOf } from "./git.ts";
import { partsOf } from "./runs.ts";
import { offline } from "./sandbox.ts";
import { must, sh } from "./sh.ts";

/** The most one test run may take, in seconds. */
export const checkLimitS = 15 * 60;

/**
 * Runs the item's test command on its worktree. Gives back its output, and the run as the ledger records it. It stops
 * when `signal` aborts.
 */
export async function runTests(r: Run, signal?: AbortSignal): Promise<TestRun> {
  // An issue with several repos: each one's suite, in its own image, on its own worktree. The first that fails is the
  // run's result and its record; all pass, the last one's.
  if (r.repos?.length) {
    const ran: TestRun[] = [];
    for (const p of partsOf(r)) {
      const t = await runTests(p, signal);
      ran.push({ ...t, out: `== ${p.repo}\n${t.out}` });
    }
    const failed = ran.find((t) => t.code !== 0);
    const last = ran.at(-1) as TestRun;
    return {
      ...(failed ?? last),
      out: ran.map((t) => t.out).join("\n"),
    };
  }
  return runIn(r, [], signal);
}

/** Runs the item's test command on its worktree, `mounts` added to its container, and records the run. */
async function runIn(
  r: Run,
  mounts: string[],
  signal?: AbortSignal,
): Promise<TestRun> {
  const tree = await treeOf(r);
  const at = Date.now();
  const ran = await sh(
    "podman",
    [
      "run",
      "--rm",
      // a test run that never ends (a watch mode, a hang) is stopped, so it never holds its attempt
      "--timeout",
      String(checkLimitS),
      ...offline,
      "-v",
      `${r.work}:/work`,
      ...mounts.flatMap((m) => ["-v", m]),
      "-w",
      "/work",
      r.image,
      "sh",
      "-c",
      r.test,
    ],
    undefined,
    undefined,
    signal,
  );
  const input = createHash("sha256")
    .update(JSON.stringify([tree, r.test, r.image]))
    .digest("hex");
  return {
    code: ran.code,
    out: ran.out,
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

/** The cl's last tests commit: da-nail's `test(<cl>): …` on the cl's branch past main, or undefined before its first. */
async function lastTests(r: Run): Promise<string | undefined> {
  const main = await mainOf(r.repo);
  const out = await must("git", [
    "-C",
    r.work,
    "log",
    "-1",
    "--format=%H",
    "--fixed-strings",
    `--grep=test(${r.name}):`,
    `${main}..HEAD`,
  ]);
  return out.trim() || undefined;
}

/**
 * The cl's red run: its test command on its tests without its code. Before da-nail's first pass the worktree holds
 * only da-nail's work, so it runs there. After it, in a throwaway checkout of da-nail's last tests commit (its tests and
 * stubs as last proven, no code on them), with `files`, the tests as they are now, copied over from the worktree. The
 * worktree's installed packages are mounted into it, so nothing installs, and the worktree is never touched. The
 * checkout is removed when the run ends.
 */
export async function runRed(
  r: Run,
  files: string[],
  signal?: AbortSignal,
): Promise<TestRun> {
  const commit = await lastTests(r);
  if (!commit) return runTests(r, signal);
  const red = join(r.dir, "red");
  rmSync(red, { recursive: true, force: true });
  mkdirSync(r.dir, { recursive: true });
  await must("git", [
    "-C",
    r.repo,
    "worktree",
    "add",
    "-q",
    "--detach",
    red,
    commit,
  ]);
  try {
    // A path that leaves the worktree is never one of its tests.
    for (const f of files) {
      if (isAbsolute(f) || normalize(f).startsWith("..")) continue;
      const from = join(r.work, f);
      if (!existsSync(from)) continue;
      mkdirSync(dirname(join(red, f)), { recursive: true });
      copyFileSync(from, join(red, f));
    }
    const deps = join(r.work, "node_modules");
    return await runIn(
      { ...r, work: red },
      existsSync(deps) ? [`${deps}:/work/node_modules`] : [],
      signal,
    );
  } finally {
    await sh("git", ["-C", r.repo, "worktree", "remove", "--force", red]);
    rmSync(red, { recursive: true, force: true });
  }
}
