/**
 * What Matt does to the factory from the command line, each a message through the ledger's one door (apply), as Matt.
 * - add <issue.md>: an issue enters at open, for the factory's planner
 * - submit <issue.md>: an issue with the spec Matt made, its cls and its plan beside it, enters at building: his pass
 *   at open and at plan review, so only the build and acceptance run it
 * - approve <issue>: his pass at plan review, for a plan the factory's planner made
 * - replan <issue>: an issue he holds, raised or escalated, back to open, its cls not landed dropped
 * Each is checked whole before anything is written, so a refusal leaves the ledger as it was.
 */

import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Built } from "../main.ts";
import { read, setStatus } from "../effects/notes.ts";
import { kebab, readSpec, specLint, typeOf } from "../process/plan.ts";
import type { Message, Repo } from "../process/step.ts";
import {
  type Reader,
  readerImage,
  reposOn,
  settingsOf,
} from "../effects/repo.ts";

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
 * What add and submit are given: the repos the issue may change, each by its path, or none, for every repo on crate
 * under `root`, among which its planner picks; and the tags of the dev images the host put on this machine, by repo
 * name. Each repo's image, full suite and setup are read from its main (effects/repo.ts).
 */
export interface Options {
  repos: string[];
  root?: string | undefined;
  dev?: Record<string, string> | undefined;
  read?: Reader | undefined;
  at?: string | undefined;
}

type At = { path: string; name: string; repos: Repo[]; done?: never };

/** The issue note at `note`, its name and its repos, or why it can't be one. */
function issueAt(
  f: () => Built,
  note: string,
  o: Options,
): At | { done: Done } {
  const no = (done: Done) => ({ done });
  const given = o.repos.length
    ? o.repos
    : o.root
      ? reposOn(o.root, o.read)
      : [];
  if (!given.length)
    return no(
      misused(
        o.root
          ? `no repo on crate under ${o.root}`
          : "an issue needs its repos: --repo, or a root to find every repo on crate under",
      ),
    );
  const path = resolve(note);
  const doc = read(path);
  if (!doc)
    return no(
      refused(existsSync(path) ? `${path} is empty` : `no note at ${path}`),
    );
  const type = typeOf(doc);
  if (type === "plan" || type === "cl")
    return no(
      refused(
        `${path} is a ${type}: submit its issue, which brings its plan and cls`,
      ),
    );
  if (type !== "issue")
    return no(
      refused(`${path}: its type is ${type || "not set"}: an issue is needed`),
    );
  const name = basename(path, ".md");
  if (!kebab.test(name))
    return no(refused(`${name}: an issue's name is kebab-case, from its note`));
  const repos: Repo[] = [];
  for (const each of given) {
    const repo = resolve(each);
    if (!existsSync(join(repo, ".git")))
      return no(refused(`${repo} is not a git repo`));
    const s = settingsOf(repo, o.dev, o.read);
    if (!s.ok) return no(refused(s.error));
    if (repos.some((r) => r.name === s.repo.name))
      return no(
        refused(
          `two repos are named ${s.repo.name}: a cl names its repo by its folder`,
        ),
      );
    repos.push(s.repo);
  }
  if (
    f()
      .ledger.items()
      .some((i) => i.name === name)
  )
    return no(refused(`${name} is in the ledger already`));
  return { path, name, repos };
}

/** Puts the issue in the ledger at open: one of one repo in that repo's image, one of several in the reader's. */
function enter(f: () => Built, at: At) {
  f().ledger.addIssueAcross({
    name: at.name,
    path: at.path,
    image: readerImage,
    repos: at.repos,
  });
}

/** add <issue.md>: an issue at open, which the factory's planner plans. */
export function add(f: () => Built, note: string, o: Options): Done {
  const at = issueAt(f, note, o);
  if (at.done) return at.done;
  enter(f, at);
  return {
    code: 0,
    lines: [
      `added ${at.name}, open, in ${at.repos.map((r) => r.name).join(", ")}`,
    ],
  };
}

/**
 * submit <issue.md>: an issue with the spec Matt made, read whole from its notes (readSpec) and linted against the repo
 * as the factory's own planner's is (specLint). It enters at building, with his two passes, and the spec is kept.
 */
export function submit(f: () => Built, note: string, o: Options): Done {
  const at = issueAt(f, note, o);
  if (at.done) return at.done;
  const got = readSpec(at.path, at.name);
  if (!got.ok) return refused(...got.errors);
  const { ledger } = f();
  const lint = specLint(got.spec, {
    taken: (c) => ledger.items().some((i) => i.name === `${at.name}-${c}`),
    repos: at.repos.map((r) => r.name),
  });
  if (lint.word !== "pass") return refused(lint.reason);
  ledger.transaction(() => {
    enter(f, at);
    ledger.apply(at.name, said("pass", "Matt planned it"), "matt");
    ledger.keepSpec(at.name, got.spec, "matt");
    ledger.apply(at.name, said("pass", "Matt approved its plan"), "matt");
  });
  const n = got.spec.cls.length;
  return {
    code: 0,
    lines: [
      `submitted ${at.name}, building, with ${n} ${n === 1 ? "cl" : "cls"}:`,
      ...got.spec.cls.map(
        (c) => `  ${at.name}-${c.name}  phase ${c.phase ?? 1}`,
      ),
    ],
  };
}

/** approve <issue>: Matt's pass at plan review, in place of plan-review's. */
export function approve(f: () => Built, name: string): Done {
  const { ledger } = f();
  const i = ledger.items().find((x) => x.name === name);
  if (!i) return refused(`no item ${name} in the ledger`);
  if (i.state !== "planned")
    return refused(`${name} is ${i.state}: approve takes an issue at planned`);
  if (ledger.open().some((a) => a.name === name))
    return refused(`${name} has an attempt open: plan-review is judging it`);
  ledger.apply(name, said("pass", "Matt approved its plan"), "matt");
  return { code: 0, lines: [`approved ${name}, building`] };
}

/** replan <issue>: an issue Matt holds, back to open, its live cls not landed dropped, and its spec let go. */
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
    for (const c of rest) {
      ledger.apply(c.name, said("drop", "Matt replans its issue"), "matt");
      setStatus(c.path, "dropped");
    }
    ledger.dropSpec(name);
    ledger.apply(
      name,
      said("replan", "Matt sends it back to be planned"),
      "matt",
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
