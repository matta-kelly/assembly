/**
 * Work on code through the door: a caller's own worktree of a repo on crate, its files, and crate's commands on it. Each
 * verb is one action, so a caller can gate each on its own (loke's tools). A worktree is a branch of the repo's clone
 * under ASSEMBLY_REPOS, kept in the factory's home (ASSEMBLY_HOME/worktrees/<name>), so podman sees it at the same path.
 * What runs, runs in the worktree's crate workspace, made as an attempt's: walled, no route, no way out. A change
 * leaves only through `land`, crate's merge queue, like every change.
 *
 *   worktrees                        each worktree: its name, repo and branch
 *   worktree <repo> <name>           a new worktree of the repo, on the branch <name>, off main
 *   read <wt> <path>                 a file
 *   write <wt> <path>                a file, its content on stdin
 *   edit <wt> <path>                 one exact replacement, {"old": "...", "new": "..."} on stdin; old occurs once
 *   search <wt> <pattern>            the lines of tracked files that match
 *   diff <wt>                        the change against main, committed or not, new files with it
 *   run <wt> <command...>            a command in the worktree's workspace
 *   check <wt>                       the repo's full suite, in its workspace
 *   commit <wt>                      every change, its message on stdin
 *   land <wt>                        its commits onto main, through crate's merge queue
 *   close <wt>                       its workspace down, the worktree and its branch removed
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { sh } from "../sh.ts";
import { fullSuite } from "../repos/repo.ts";

/** The verbs of work, in the order above. */
export const workVerbs = [
  "worktrees",
  "worktree",
  "read",
  "write",
  "edit",
  "search",
  "diff",
  "run",
  "check",
  "commit",
  "land",
  "close",
];

/** A verb's result: its exit code, what it gives back, and why it failed. */
export interface Worked {
  code: number;
  out: string;
  err: string;
}

/** Where work happens: the clones, and the folder of worktrees. */
export interface Desk {
  repos: string;
  worktrees: string;
}

const name = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ok = (out: string): Worked => ({ code: 0, out, err: "" });
const no = (err: string): Worked => ({ code: 1, out: "", err });
const ran = (r: { code: number; out: string }): Worked =>
  r.code === 0 ? ok(r.out) : { code: r.code, out: "", err: r.out };

/** The worktree <wt>, when it is one of the desk's. */
function worktreeOf(d: Desk, wt: string | undefined): string | Worked {
  if (!wt || !name.test(wt)) return no(`not a worktree name: ${wt ?? ""}`);
  const at = join(d.worktrees, wt);
  if (!existsSync(join(at, ".git"))) return no(`no worktree ${wt}`);
  return at;
}

/** A path inside the worktree, never its .git nor outside it. */
function inside(at: string, path: string | undefined): string | Worked {
  if (!path) return no("a path is needed");
  const full = resolve(at, path);
  const rel = relative(at, full);
  if (rel === "" || rel.startsWith("..") || resolve(at, rel) !== full)
    return no(`${path} is not inside the worktree`);
  if (rel === ".git" || rel.startsWith(`.git${sep}`))
    return no(`${path} is in .git`);
  return full;
}

const git = (at: string, ...args: string[]) => sh("git", ["-C", at, ...args]);
const crate = (at: string, args: string[], stdin?: string) =>
  sh("crate", ["-C", at, ...args], stdin);

/** Its workspace up, as an attempt's: a second up changes nothing. */
async function up(at: string): Promise<Worked | undefined> {
  const u = await crate(at, ["up", "--attempt"]);
  return u.code === 0 ? undefined : ran(u);
}

/** Runs the verb of work with its arguments, and stdin. */
export async function work(
  d: Desk,
  verb: string,
  args: string[],
  stdin: () => Promise<string>,
): Promise<Worked> {
  const [first, second, ...rest] = args;
  if (verb === "worktrees") {
    if (!existsSync(d.worktrees)) return ok("");
    const lines: string[] = [];
    for (const wt of readdirSync(d.worktrees).sort()) {
      const at = join(d.worktrees, wt);
      if (!existsSync(join(at, ".git"))) continue;
      const branch = (await git(at, "branch", "--show-current")).stdout.trim();
      const common = (
        await git(at, "rev-parse", "--git-common-dir")
      ).stdout.trim();
      lines.push(
        `${wt} ${relative(d.repos, dirname(resolve(at, common)))} ${branch}`,
      );
    }
    return ok(lines.join("\n"));
  }
  if (verb === "worktree") {
    if (!first || !name.test(first))
      return no(`not a repo name: ${first ?? ""}`);
    if (!second || !name.test(second))
      return no(`not a worktree name: ${second ?? ""}`);
    const repo = join(d.repos, first);
    if (!existsSync(join(repo, ".git"))) return no(`no repo ${first}`);
    const at = join(d.worktrees, second);
    if (existsSync(at)) return no(`worktree ${second} is there already`);
    const fetched = await git(repo, "fetch", "-q", "server");
    if (fetched.code !== 0) return ran(fetched);
    mkdirSync(d.worktrees, { recursive: true });
    const made = await git(
      repo,
      "worktree",
      "add",
      "-q",
      "-b",
      second,
      at,
      "server/main",
    );
    return made.code === 0
      ? ok(`${second}: ${first} at main, in ${at}`)
      : ran(made);
  }
  if (!workVerbs.includes(verb)) return no(`no verb ${verb}`);
  const at = worktreeOf(d, first);
  if (typeof at !== "string") return at;
  switch (verb) {
    case "read":
    case "write":
    case "edit": {
      const file = inside(at, second);
      if (typeof file !== "string") return file;
      if (verb === "read") {
        if (!existsSync(file)) return no(`no file ${second}`);
        return ok(readFileSync(file, "utf8"));
      }
      if (verb === "write") {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, await stdin());
        return ok(`wrote ${second}`);
      }
      if (!existsSync(file)) return no(`no file ${second}`);
      let e: { old?: unknown; new?: unknown };
      try {
        e = JSON.parse(await stdin()) as typeof e;
      } catch {
        return no('edit takes {"old": "...", "new": "..."} on stdin');
      }
      if (
        typeof e.old !== "string" ||
        typeof e.new !== "string" ||
        e.old === ""
      )
        return no(
          'edit takes {"old": "...", "new": "..."} on stdin, old not empty',
        );
      const text = readFileSync(file, "utf8");
      const times = text.split(e.old).length - 1;
      if (times !== 1)
        return no(`old occurs ${times} times in ${second}, not once`);
      writeFileSync(
        file,
        text.replace(e.old, () => e.new as string),
      );
      return ok(`edited ${second}`);
    }
    case "search": {
      const pattern = [second, ...rest].join(" ").trim();
      if (!pattern) return no("a pattern is needed");
      const found = await git(at, "grep", "-n", "-I", "-e", pattern);
      if (found.code === 1) return ok("");
      return ran(found);
    }
    case "diff": {
      // new files are in the change: marked as intended, so the diff shows them
      const marked = await git(at, "add", "-A", "-N");
      if (marked.code !== 0) return ran(marked);
      return ran(await git(at, "diff", "server/main"));
    }
    case "run":
    case "check": {
      const command =
        verb === "check"
          ? fullSuite.split(" ")
          : [second, ...rest].filter((w): w is string => !!w);
      if (command.length === 0) return no("a command is needed");
      const notUp = await up(at);
      if (notUp) return notUp;
      return ran(await crate(at, ["run", "--", ...command]));
    }
    case "commit": {
      const message = (await stdin()).trim();
      if (!message) return no("a commit message is needed on stdin");
      const added = await git(at, "add", "-A");
      if (added.code !== 0) return ran(added);
      if ((await git(at, "diff", "--cached", "--quiet")).code === 0)
        return no("nothing to commit");
      return ran(
        await sh("git", ["-C", at, "commit", "-q", "-F", "-"], message),
      );
    }
    case "land":
      return ran(await crate(at, ["land"]));
    case "close": {
      await crate(at, ["down"]);
      const common = (
        await git(at, "rev-parse", "--git-common-dir")
      ).stdout.trim();
      const repo = dirname(resolve(at, common));
      const branch = (await git(at, "branch", "--show-current")).stdout.trim();
      const removed = await git(repo, "worktree", "remove", "--force", at);
      if (removed.code !== 0) return ran(removed);
      if (branch) await git(repo, "branch", "-D", branch);
      return ok(`closed ${first}`);
    }
  }
  return no(`no verb ${verb}`);
}
