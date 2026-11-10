/**
 * Test runs: the item's test command, in a container of its own, offline. A test run never runs in the agent's sandbox.
 * A bound attempt's runs on its item's full worktree, with the attempt's change inside its scope applied (git.ts,
 * stage): the agent's `test` tool and its step's check are the same op, on the tree a pass commits. Any other attempt's
 * runs on its own worktree. Each run is recorded with its inputs (the tree, the command and the image), so the same
 * inputs could be looked up again.
 */

import { createHash } from "node:crypto";
import type { Run, TestRun } from "../process/step.ts";
import { fullOf, stage, treeOf } from "./git.ts";
import { prepareFull } from "./setup.ts";
import { offline } from "./sandbox.ts";
import { sh } from "./sh.ts";

/** The most one test run may take, in seconds. */
export const checkLimitS = 15 * 60;

/**
 * Runs the item's test command, on the attempt's full worktree when it is bound, else on its own. Gives back its output, and the run as the ledger records it. It stops
 * when `signal` aborts.
 */
export async function runTests(r: Run, signal?: AbortSignal): Promise<TestRun> {
  let tree: string;
  let on = r.work;
  if (r.scope) {
    await prepareFull(r, signal);
    tree = await stage(r);
    on = fullOf(r);
  } else tree = await treeOf(r);
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
      `${on}:/work`,
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
