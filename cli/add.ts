/**
 * What enters the factory: add <note.md>, by the note's kinetic type. An issue enters at open, for the factory's
 * planner. A plan made outside the factory, or the lone cl of an issue that takes one, enters with its cls ready and
 * waiting, so only the inner loop and acceptance run them. Each is checked whole before anything is written, so a
 * refusal leaves the ledger as it was.
 */

import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Built } from "../main.ts";
import { admit } from "../orchestrator/advance.ts";
import { read } from "../effects/notes.ts";
import {
  kebab,
  lintCuts,
  type Read,
  readCl,
  readPlan,
  typeOf,
} from "../process/plan.ts";

/** What a command gives back: an exit code, and the lines it prints (to stderr when it refuses). */
export type Done = { code: number; lines: string[] };

const refused = (...lines: string[]): Done => ({ code: 1, lines });
const misused = (line: string): Done => ({ code: 2, lines: [line] });

/**
 * What add is given: the issue's image, which its attempts run on, its full suite, which acceptance runs, and its setup,
 * which installs the repo's dependencies into each new worktree (none when left out); the repo,
 * for an issue only (a cl's is in its Files); and what a repo's `~` is.
 */
export interface Options {
  image: string;
  test: string;
  setup?: string | undefined; // what installs the repo's dependencies into a new worktree, offline
  repo?: string | undefined;
  home: string;
}

/** add <note.md>: an issue, a plan or a lone cl, by its note's type. */
export function add(f: () => Built, note: string, o: Options): Done {
  const path = resolve(note);
  const doc = read(path);
  if (!doc)
    return refused(
      existsSync(path) ? `${path} is empty` : `no note at ${path}`,
    );
  const type = typeOf(doc);
  if (type === "issue") return addIssue(f, path, o);
  if (type !== "plan" && type !== "cl")
    return refused(
      `${path}: its type is ${type || "not set"}: add takes an issue, a plan or a cl`,
    );
  if (o.repo !== undefined)
    return misused(`--repo is an issue's: a ${type}'s repo is in its Files`);
  return addCuts(f, (type === "plan" ? readPlan : readCl)(path, o.home), o);
}

/** An issue at open, which the factory's planner plans. */
function addIssue(f: () => Built, path: string, o: Options): Done {
  if (!o.repo) return misused("an issue needs --repo");
  const name = basename(path, ".md");
  const repo = resolve(o.repo);
  if (!kebab.test(name))
    return refused(`${name}: an issue's name is kebab-case, from its note`);
  if (!existsSync(join(repo, ".git")))
    return refused(`${repo} is not a git repo`);
  const b = f();
  if (b.ledger.items().some((i) => i.name === name))
    return refused(`${name} is in the ledger already`);
  b.ledger.addIssue({
    name,
    path,
    repo,
    image: o.image,
    test: o.test,
    setup: o.setup ?? "",
  });
  return { code: 0, lines: [`added ${name}, open`] };
}

/**
 * Cuts made and reviewed outside the factory: their issue enters at building and its cls at ready and waiting. Read
 * whole from their notes (readPlan, readCl), and linted against the repo as the factory's own planner's are (lintCuts).
 */
function addCuts(f: () => Built, got: Read, o: Options): Done {
  if (!got.ok) return refused(...got.errors);
  const { issue, repo, plan } = got;
  if (!existsSync(join(repo, ".git")))
    return refused(`${repo} is not a git repo`);
  const b = f();
  const has = (n: string) => b.ledger.items().some((i) => i.name === n);
  const lint = lintCuts(plan, {
    exists: (files) => files.filter((x) => existsSync(join(repo, x))),
    taken: (c) => has(`${issue.name}-${c}`),
  });
  if (lint.word !== "pass") return refused(lint.reason);
  if (has(issue.name)) return refused(`${issue.name} is in the ledger already`);
  admit(
    b.ledger,
    { ...issue, repo, image: o.image, test: o.test, setup: o.setup ?? "" },
    plan,
  );
  const n = plan.cuts.length;
  return {
    code: 0,
    lines: [
      `added ${issue.name}, building, with ${n} ${n === 1 ? "cl" : "cls"}:`,
      ...plan.cuts.map(
        (c, i) => `  ${issue.name}-${c.name}  ${i === 0 ? "ready" : "waiting"}`,
      ),
    ],
  };
}
