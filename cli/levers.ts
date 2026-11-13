/**
 * What Matt does to the factory from the command line, each a message through the ledger's one door (apply), as Matt.
 * - submit <issue>: the issue's note, `_well/<issue>.md` at the notes' main, enters. With cl notes there that belong to
 *   it, his spec, linted as the planner's is, it enters at building; with none, at open, for the factory's planner
 * - approve <issue>: his pass at plan review, for a plan the factory's planner made: it lands in the notes as it is
 * - replan <issue>: an issue he holds, raised or escalated, back to open, its cls not landed dropped
 * - retry <item>: an escalated item back to where it was when it was escalated
 * Each is checked whole before anything is written, so a refusal leaves the ledger as it was.
 */

import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Built } from "../main.ts";
import { notesNow } from "../orchestrator/advance.ts";
import { itemsIn } from "../effects/notes.ts";
import {
  clNotesOf,
  kebab,
  noteOf,
  readSpec,
  specLint,
  typeOf,
} from "../process/plan.ts";
import type { Message } from "../process/step.ts";
import { type Reader, reposOn } from "../effects/repo.ts";

/** What a command gives back: an exit code, and the lines it prints (to stderr when it refuses). */
export type Done = { code: number; lines: string[] };

const refused = (...lines: string[]): Done => ({ code: 1, lines });
const misused = (line: string): Done => ({ code: 2, lines: [line] });
const said = (word: Message["word"], reason: string): Message => ({
  word,
  reason,
  findings: [],
});

/**
 * What submit is given: the repos the issue may change, each by its path, or none, for every repo on crate under
 * `root`, among which its planner picks; and the notes repo, which holds the issue's note and is never one of them.
 */
export interface Options {
  repos: string[];
  root?: string | undefined;
  notes: string;
  read?: Reader | undefined;
}

/** The paths of the repos an issue may change: those given, else every repo on crate under the root but the notes'. */
export function given(
  o: Options,
): { paths: string[]; done?: never } | { done: Done } {
  const notes = resolve(o.notes);
  const paths = o.repos.length
    ? o.repos.map((each) => resolve(each))
    : o.root
      ? reposOn(o.root, o.read).filter((p) => resolve(p) !== notes)
      : [];
  if (paths.length) return { paths };
  return {
    done: misused(
      o.root
        ? `no repo on crate under ${o.root}`
        : "an issue needs its repos: --repo, or a root to find every repo on crate under",
    ),
  };
}

/** The folder of the notes repo that holds the issues' notes. */
const wellDir = "_well";

/**
 * submit <issue>: the issue's note `_well/<issue>.md` at the notes' main as it is now, read with git, never from a
 * working tree. With cl notes that belong to it, the spec Matt made, it is linted as the factory's own planner's is
 * (specLint), each cl new, and enters at building, where the factory builds it from those notes. With none, it enters at
 * open, for the factory's planner.
 */
export async function submit(
  f: () => Built,
  issue: string,
  o: Options,
): Promise<Done> {
  if (!kebab.test(issue))
    return refused(`${issue}: an issue's name is kebab-case`);
  const paths = given(o);
  if (paths.done) return paths.done;
  for (const repo of paths.paths)
    if (!existsSync(join(repo, ".git")))
      return refused(`${repo} is not a git repo`);
  const names = paths.paths.map((p) => basename(p));
  const twice = names.find((n, i) => names.indexOf(n) !== i);
  if (twice)
    return refused(
      `two repos are named ${twice}: a cl names its repo by its folder`,
    );
  const { ledger } = f();
  if (ledger.items().some((i) => i.name === issue))
    return refused(`${issue} is in the ledger already`);
  let notes;
  try {
    notes = await notesNow(o.notes);
  } catch (e) {
    return refused(`the notes were not read: ${(e as Error).message}`);
  }
  const note = `${wellDir}/${issue}.md`;
  const doc = notes.text(note);
  if (!doc) return refused(`no note ${note} at the main of ${o.notes}`);
  if (typeOf(doc) !== "issue")
    return refused(
      `${note}: its type is ${typeOf(doc) || "not set"}: an issue is needed`,
    );
  const at = { name: issue, note, repos: paths.paths };
  if (!clNotesOf(notes, note, issue).length) {
    if (!itemsIn(noteOf(doc).body, "Done").length)
      return refused(`${note}: its Done has no items`);
    ledger.addIssue(at, "open");
    return {
      code: 0,
      lines: [`submitted ${issue}, open, in ${names.join(", ")}`],
    };
  }
  const spec = readSpec(notes, note, issue, true);
  if (!spec.ok) return refused(...spec.errors);
  const lint = specLint(spec.spec, {
    taken: (c) => ledger.items().some((i) => i.name === `${issue}-${c}`),
    repos: names,
  });
  if (lint.word !== "pass") return refused(lint.reason);
  ledger.addIssue(at, "building");
  const n = spec.spec.cls.length;
  return {
    code: 0,
    lines: [
      `submitted ${issue}, building, with ${n} ${n === 1 ? "cl" : "cls"}:`,
      ...spec.spec.cls.map(
        (c) => `  ${issue}-${c.name}  phase ${c.phase ?? 1}`,
      ),
    ],
  };
}

/** approve <issue>: Matt's pass at plan review, in place of plan-review's: the plan lands in the notes as it is. */
export function approve(f: () => Built, name: string): Done {
  const { ledger } = f();
  const i = ledger.items().find((x) => x.name === name);
  if (!i) return refused(`no item ${name} in the ledger`);
  if (i.state !== "planned")
    return refused(`${name} is ${i.state}: approve takes an issue at planned`);
  if (ledger.open().some((a) => a.name === name))
    return refused(`${name} has an attempt open: plan-review is judging it`);
  ledger.apply(name, said("pass", "Matt approved its plan"), "matt");
  return { code: 0, lines: [`approved ${name}: its plan lands`] };
}

/**
 * retry <item>: an escalated item back to where it was when it was escalated, once its cause is fixed: its cls and
 * their attempts as they are. An escalated issue takes its escalated cls back with it.
 */
export function retry(f: () => Built, name: string): Done {
  const { ledger } = f();
  const i = ledger.items().find((x) => x.name === name);
  if (!i) return refused(`no item ${name} in the ledger`);
  if (i.state !== "escalated")
    return refused(
      `${name} is ${i.state}: retry takes an item that is escalated`,
    );
  const items = [
    i,
    ...(i.kind === "issue"
      ? ledger.cls(name).filter((c) => c.state === "escalated")
      : []),
  ];
  const moved: string[] = [];
  ledger.transaction(() => {
    for (const x of items) {
      const to = ledger.apply(
        x.name,
        said("resume", "Matt retries it"),
        "matt",
      );
      moved.push(`  ${x.name}  ${to}`);
    }
  });
  return { code: 0, lines: [`retried ${name}:`, ...moved] };
}

/** replan <issue>: an issue Matt holds, back to open, its live cls not landed dropped. */
export function replan(f: () => Built, name: string): Done {
  const { ledger } = f();
  const i = ledger.items().find((x) => x.name === name);
  if (!i) return refused(`no item ${name} in the ledger`);
  if (i.kind !== "issue" || (i.state !== "raised" && i.state !== "escalated"))
    return refused(
      `${name} is ${i.state}: replan takes an issue that is raised or escalated`,
    );
  if (ledger.open().some((a) => a.name === name))
    return refused(`${name} has an attempt open`);
  const rest = ledger
    .cls(name)
    .filter((c) => !["landed", "dropped"].includes(c.state));
  ledger.transaction(() => {
    for (const c of rest)
      ledger.apply(c.name, said("drop", "Matt replans its issue"), "matt");
    ledger.apply(
      name,
      said("resume", "Matt sends it back to be planned"),
      "matt",
      "open",
    );
  });
  return {
    code: 0,
    lines: [
      `${name} is open, for the factory's planner`,
      ...rest.map((c) => `  ${c.name}  dropped`),
    ],
  };
}
