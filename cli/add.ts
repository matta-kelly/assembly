/**
 * What enters the factory: add, an issue for its planner; add-plan, a plan made outside it, whose cls go straight to
 * the inner loop. Each checks its input whole before it writes, so a refusal leaves the ledger as it was.
 */

import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Built } from "../main.ts";
import { admit } from "../orchestrator/advance.ts";
import { kebab, lintCuts, readPlan } from "../process/plan.ts";

/** What a command gives back: an exit code, and the lines it prints (to stderr when it refuses). */
export type Done = { code: number; lines: string[] };

const refused = (...lines: string[]): Done => ({ code: 1, lines });

/** The issue's own parts, for either: the image its attempts run on, and the full suite acceptance runs. */
export interface IssueRun {
  image: string;
  test: string;
}

/** add <issue.md> --repo --image --test: an issue at open, which the factory's planner plans. */
export function add(
  f: () => Built,
  note: string,
  o: IssueRun & { repo: string },
): Done {
  const path = resolve(note);
  const name = basename(path, ".md");
  const repo = resolve(o.repo);
  if (!kebab.test(name))
    return refused(`${name}: an issue's name is kebab-case, from its note`);
  if (!existsSync(path)) return refused(`no issue note at ${path}`);
  if (!existsSync(join(repo, ".git")))
    return refused(`${repo} is not a git repo`);
  const b = f();
  if (b.ledger.items().some((i) => i.name === name))
    return refused(`${name} is in the ledger already`);
  b.ledger.addIssue({ name, path, repo, image: o.image, test: o.test });
  return { code: 0, lines: [`added ${name}, open`] };
}

/**
 * add-plan <plan.md> --image --test: a kinetic plan and its cl notes, made and reviewed outside the factory. Its issue
 * enters at building and its cls at ready and waiting, so only the inner loop and acceptance run them. Its notes are
 * read whole (readPlan), and its cuts linted against the repo as the factory's own planner's are (lintCuts).
 */
export function addPlan(
  f: () => Built,
  note: string,
  o: IssueRun & { home: string },
): Done {
  const read = readPlan(resolve(note), o.home);
  if (!read.ok) return refused(...read.errors);
  const { issue, repo, plan } = read;
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
  admit(b.ledger, { ...issue, repo, image: o.image, test: o.test }, plan);
  return {
    code: 0,
    lines: [
      `added ${issue.name}, building, with ${plan.cuts.length} cls:`,
      ...plan.cuts.map(
        (c, i) => `  ${issue.name}-${c.name}  ${i === 0 ? "ready" : "waiting"}`,
      ),
    ],
  };
}
