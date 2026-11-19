/**
 * Test runs: a command, in a container of its own, offline, on the item's worktree, with what the attempt changed in
 * it: the repo's full suite (runTests), or one listed test (listed.ts). A test run never runs in the agent's sandbox, and the agent's `test` tool and its step's check
 * are the same op, on the tree a pass commits. Each run is recorded with its inputs (the tree, the command and the
 * image), so the same inputs could be looked up again.
 */

import { createHash } from "node:crypto";
import type { Run, TestRun } from "../line/step.ts";
import { treeOf } from "../repos/git.ts";
import { partsOf } from "./runs.ts";
import { offline } from "./sandbox.ts";
import { sh } from "../sh.ts";

/** The most one test run may take, in seconds. */
export const checkLimitS = 15 * 60;

/**
 * Runs the item's full suite on its worktree. Gives back its output, and the run as the ledger records it. It stops
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
  return runIn(r, r.test, signal);
}

/**
 * Runs `command` in the item's image, offline, on its worktree at /work, and records it with its inputs. It stops when
 * `signal` aborts.
 */
export async function runIn(
  r: Run,
  command: string,
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
      "-w",
      "/work",
      r.image,
      "sh",
      "-c",
      command,
    ],
    undefined,
    undefined,
    signal,
  );
  const input = createHash("sha256")
    .update(JSON.stringify([tree, command, r.image]))
    .digest("hex");
  return {
    code: ran.code,
    out: ran.out,
    check: {
      command,
      image: r.image,
      tree,
      input,
      code: ran.code,
      at,
      ms: Date.now() - at,
    },
  };
}
