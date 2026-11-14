/**
 * The land: an approved cl onto main, the one way a cl's work reaches it. It runs in the cl's worktree, on its branch
 * (git.ts), so a rebase there moves the branch, and gives back the message its attempt ends with.
 *
 * Through crate, when the land target is `server`: `crate land`, the merge queue's own client, which puts the cl's
 * branch in the queue and waits for its verdict. crate checks it on top of the changes ahead of it and picks it onto main, so the land neither
 * rebases nor tests, and main may take the cl's change as a commit of its own:
 * - a cl whose change main holds already passes as it is: crate records each land at refs/landed/<the change's sha>
 * - landed: the cl's branch is main, and the commit main took, its refs/landed, is the one the land gives back
 * - not landed, in crate's verdict line: a change that does not apply on main and the changes ahead is a back about the plan; a change that
 *   left the queue is a retry; any other is its check's red, a back about the code, with its output
 *
 * Through `git land`, for a repo not on crate yet, in four moves:
 * - rebase the cl's branch onto main as the land target has it now. A conflict is a back about the plan, since keeping
 *   the cls of one phase apart is the plan's work, and main does not move
 * - a cl whose change main holds already passes as it is: a land a stop cut off, after its push, is not landed twice
 * - when main moved under the cl, run its test command on the rebased tree. A red is a back about the code, and the
 *   cl's branch stays on the rebased tree, so da-hammer works on the code main will hold
 * - `git land`, which pushes to main through the repo's gate, as Matt. A land it refuses is a retry
 * On a pass, the cl's branch is the commit main took, which the land gives back. A push to GitHub is authenticated by
 * GH_TOKEN, through gh as git's credential helper, set for this one command, so no credential is written to disk.
 */

import type { Message, Run, TestRun } from "../line/step.ts";
import { mainOf, targetOf } from "./git.ts";
import { must, sh } from "../sh.ts";
import { runTests } from "../runs/tests.ts";

/**
 * A land's outcome: its message, the files the cl changed, the commit main took on a pass, and the test run it made,
 * if main had moved.
 */
export interface Land {
  message: Message;
  files: string[];
  commit?: string;
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
        commit: tip,
        message: {
          word: "pass",
          reason: `landed: ${main} holds its change, at ${tip.slice(0, 7)}`,
          findings: [],
        },
      },
    };
  return { ready: true, head, tip };
}

/** crate's verdict on a change it did not land: its `crate: not landed: <why>` line, or undefined. */
const verdictOf = (out: string) =>
  out.match(/crate: not landed: (.*)$/m)?.[1]?.trim();

async function throughCrate(
  r: Run,
  at: string,
  files: string[],
  signal?: AbortSignal,
): Promise<Land> {
  const main = await mainOf(r.repo);
  const sha = (await must("git", ["-C", at, "rev-parse", "HEAD"])).trim();
  // crate records each change it lands at refs/landed/<its sha>, pointing at the main commit it landed as: the exact
  // verdict, where main may hold the change as a commit of its own
  const landedAs = async () =>
    (
      await sh("git", ["-C", at, "ls-remote", "server", `refs/landed/${sha}`])
    ).out
      .split(/\s/)[0]
      ?.trim() || undefined;
  const pass = (reason: string, commit: string): Land => ({
    files,
    commit,
    message: {
      word: "pass",
      reason: `${reason} at ${commit.slice(0, 7)}`,
      findings: [],
    },
  });
  // A land a stop cut off after the queue took it is not landed twice.
  const before = await landedAs();
  if (before) return pass(`landed: ${main} holds its change`, before);
  const landed = await sh(
    "crate",
    ["-C", at, "land"],
    undefined,
    process.env,
    signal,
  );
  if (landed.code === 0) {
    const commit = await landedAs();
    if (commit) return pass(`landed on ${main}`, commit);
  }
  const why = verdictOf(landed.out);
  const tail = landed.out.slice(-600);
  if (!why || /left the queue/.test(why))
    return {
      files,
      message: {
        word: "retry",
        reason: `crate land did not land it: ${tail}`,
        findings: [],
      },
    };
  if (/does not apply/.test(why))
    return {
      files,
      message: {
        word: "back",
        cause: "restack_conflict",
        reason: "it conflicts with the changes ahead of it",
        findings: [
          {
            about: "plan",
            what: `crate could not put ${r.name} on main: ${why}. Another cl changed the same code`,
            where: r.name,
          },
        ],
      },
    };
  return {
    files,
    message: {
      word: "back",
      cause: "check_failed",
      reason: "red on main",
      findings: [
        {
          about: "code",
          what: `crate's check on main with it refused it: ${tail}`,
          where: r.test,
        },
      ],
    },
  };
}

export async function land(r: Run, signal?: AbortSignal): Promise<Land> {
  const at = r.work;
  const git = (...args: string[]) => must("git", ["-C", at, ...args]);
  const main = await mainOf(r.repo);
  const base = (await git("merge-base", "HEAD", main)).trim();
  // The cl's own change: what its branch holds past where it left main.
  const files = lines(await git("diff", "--name-only", base, "HEAD"));
  if ((await targetOf(r.repo)) === "server")
    return throughCrate(r, at, files, signal);
  const step = await rebase(r, at, main, files);
  if (!step.ready) return step.done;
  const { tip } = step;
  let ran: TestRun | undefined;
  if (base !== tip) {
    ran = await runTests(r, signal);
    if (ran.code !== 0)
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
  return {
    files,
    commit,
    ...(ran ? { ran } : {}),
    message: {
      word: "pass",
      reason: `landed on ${main} at ${commit.slice(0, 7)}`,
      findings: [],
    },
  };
}
