/**
 * The land: an approved cl onto main, the one way a cl's work reaches it. It runs on the cl's full worktree (git.ts),
 * and gives back the message its attempt ends with.
 *
 * Through crate, when the land target is `server`: rebase onto main, then a plain `git push` to main. crate's
 * pre-receive hook runs the repo's check on the exact tree main becomes, so the land runs no test of its own:
 * - a conflict is a back about the plan, and a cl whose change main holds already passes as it is
 * - the hook's red is a back about the code, with its output, and the cl's branch moves to the rebased tree
 * - main moved while the push waited: fetch, rebase and push again, three times at most, then a retry
 *
 * Through `git land`, for a repo not on crate yet, in four moves:
 * - rebase the cl's branch onto main as the land target has it now. A conflict is a back about the plan, since keeping
 *   the cls of one phase apart is the plan's work, and main does not move
 * - a cl whose change main holds already passes as it is: a land a stop cut off, after its push, is not landed twice
 * - when main moved under the cl, run its test command on the rebased tree. A red is a back about the code, and the
 *   cl's branch moves to the rebased tree, so da-hammer works on the code main will hold
 * - `git land`, which pushes to main through the repo's gate, as Matt. A land it refuses is a retry
 * On a pass, the cl's branch is the commit main took. A push to GitHub is authenticated by GH_TOKEN, through gh as
 * git's credential helper, set for this one command, so no credential is written to disk.
 */

import { mkdirSync } from "node:fs";
import type { Message, Run, TestRun } from "../process/step.ts";
import { branchOf, fullOf, mainOf, targetOf } from "./git.ts";
import { prepareFull } from "./setup.ts";
import { must, sh } from "./sh.ts";
import { runTests } from "./tests.ts";

/** A land's outcome: its message, the files the cl changed, and the test run it made, if main had moved. */
export interface Land {
  message: Message;
  files: string[];
  ran?: TestRun;
}

/** git's environment for a push: gh answers git's credential requests from GH_TOKEN, when it is set. */
const pushEnv = (): NodeJS.ProcessEnv =>
  process.env["GH_TOKEN"]
    ? {
        ...process.env,
        GIT_CONFIG_COUNT: "2",
        GIT_CONFIG_KEY_0: "credential.helper",
        GIT_CONFIG_VALUE_0: "",
        GIT_CONFIG_KEY_1: "credential.helper",
        GIT_CONFIG_VALUE_1: "!gh auth git-credential",
      }
    : process.env;

const lines = (out: string) => out.split("\n").filter(Boolean);

/** The rebase onto main, or the message that ends the land before a push: a conflict, or main holds the change. */
async function rebase(
  r: Run,
  at: string,
  main: string,
  files: string[],
): Promise<
  { ready: false; done: Land } | { ready: true; head: string; tip: string }
> {
  const git = (...args: string[]) => must("git", ["-C", at, ...args]);
  const tip = (await git("rev-parse", main)).trim();
  const rebased = await sh("git", ["-C", at, "rebase", "-q", main]);
  if (rebased.code !== 0) {
    const conflicts = lines(
      await git("diff", "--name-only", "--diff-filter=U"),
    );
    await sh("git", ["-C", at, "rebase", "--abort"]);
    return {
      ready: false,
      done: {
        files,
        message: {
          word: "back",
          cause: "restack_conflict",
          reason: "it does not rebase onto main",
          findings: [
            {
              about: "plan",
              what: `rebasing ${r.name} onto main conflicts in ${conflicts.join(", ") || "its files"}: another cl changed the same code`,
              where: r.name,
            },
          ],
        },
      },
    };
  }
  const head = (await git("rev-parse", "HEAD")).trim();
  if (head === tip)
    return {
      ready: false,
      done: {
        files,
        message: {
          word: "pass",
          reason: `landed: ${main} holds its change, at ${tip.slice(0, 7)}`,
          findings: [],
        },
      },
    };
  return { ready: true, head, tip };
}

/** Points the cl's branch at `commit`, so its next attempt, or what main took, is the branch. */
const moveBranch = (r: Run, commit: string) =>
  must("git", [
    "-C",
    r.repo,
    "update-ref",
    `refs/heads/${branchOf(r.name)}`,
    commit,
  ]);

/** crate's hook refused the push because main moved, or the push was not a fast-forward: go again. */
const moved = (out: string) =>
  /main moved|not a fast-forward|non-fast-forward|fetch first/.test(out);

async function throughCrate(
  r: Run,
  at: string,
  files: string[],
  signal?: AbortSignal,
): Promise<Land> {
  for (let tries = 0; tries < 3; tries++) {
    const main = await mainOf(r.repo);
    const step = await rebase(r, at, main, files);
    if (!step.ready) return step.done;
    const pushed = await sh(
      "git",
      ["-C", at, "push", "-q", "server", "HEAD:refs/heads/main"],
      undefined,
      process.env,
      signal,
    );
    if (pushed.code === 0) {
      await moveBranch(r, step.head);
      return {
        files,
        message: {
          word: "pass",
          reason: `landed on ${main} at ${step.head.slice(0, 7)}`,
          findings: [],
        },
      };
    }
    if (moved(pushed.out)) continue;
    await moveBranch(r, step.head);
    return {
      files,
      message: {
        word: "back",
        cause: "check_failed",
        reason: "red on main",
        findings: [
          {
            about: "code",
            what: `rebased onto main, crate's check refused it: ${pushed.out.slice(-600)}`,
            where: r.test,
          },
        ],
      },
    };
  }
  return {
    files,
    message: {
      word: "retry",
      reason: "main kept moving while it waited, three times",
      findings: [],
    },
  };
}

export async function land(r: Run, signal?: AbortSignal): Promise<Land> {
  mkdirSync(r.dir, { recursive: true });
  await prepareFull(r, signal);
  const at = fullOf(r);
  const git = (...args: string[]) => must("git", ["-C", at, ...args]);
  const main = await mainOf(r.repo);
  await git("checkout", "-q", "--force", "--detach", branchOf(r.name));
  const base = (await git("merge-base", "HEAD", main)).trim();
  // The cl's own change: what its branch holds past where it left main.
  const files = lines(await git("diff", "--name-only", base, "HEAD"));
  if ((await targetOf(r.repo)) === "server")
    return throughCrate(r, at, files, signal);
  const step = await rebase(r, at, main, files);
  if (!step.ready) return step.done;
  const { head, tip } = step;
  let ran: TestRun | undefined;
  if (base !== tip) {
    ran = await runTests({ ...r, work: at }, signal);
    if (ran.code !== 0) {
      await moveBranch(r, head);
      return {
        files,
        ran,
        message: {
          word: "back",
          cause: "check_failed",
          reason: "red on main",
          findings: [
            {
              about: "code",
              what: `rebased onto main, its tests are red: exit ${ran.code}: ${ran.out.slice(-400)}`,
              where: r.test,
            },
          ],
        },
      };
    }
  }
  const landed = await sh(
    "git",
    ["-C", at, "land"],
    undefined,
    pushEnv(),
    signal,
  );
  if (landed.code !== 0)
    return {
      files,
      ...(ran ? { ran } : {}),
      message: {
        word: "retry",
        reason: `git land refused it: ${landed.out.slice(-400)}`,
        findings: [],
      },
    };
  const commit = (await git("rev-parse", "HEAD")).trim();
  await moveBranch(r, commit);
  return {
    files,
    ...(ran ? { ran } : {}),
    message: {
      word: "pass",
      reason: `landed on ${main} at ${commit.slice(0, 7)}`,
      findings: [],
    },
  };
}
